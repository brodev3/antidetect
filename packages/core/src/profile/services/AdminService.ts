import fs from 'fs';
import path from 'path';
import { profilesRepo, withTransaction, auditRepo } from '@antidetect/db';
import { resolveProfileDir } from '../utils/paths';
import { sanitizeName, ErrorCode, AuditEvent, isErrorCode } from '@antidetect/shared';
import { lock } from '../utils/locks';
import { isErrnoException } from '@antidetect/shared';
import type { GetProfileResult, ListProfilesResult, RenameProfileResult, DeleteProfileResult } from '@antidetect/shared';

function resolveDir(name: string): string {
  return resolveProfileDir(name);
}

/** Fetches a single profile by name and formats date fields as ISO strings. */
export async function getProfile(name: string): Promise<GetProfileResult> {
  const safeName = sanitizeName(name);
  const p = await profilesRepo.findByName(safeName);
  if (!p) throw new Error(ErrorCode.ProfileNotFound);
  return {
    id: p.id,
    name: p.name,
    dir: p.profileDir,
    isOpen: p.isOpen,
    lastOpenedAt: p.lastOpenedAt?.toISOString() ?? null,
    lastClosedAt: p.lastClosedAt?.toISOString() ?? null,
  };
}

/** Returns all profiles with normalized transport-friendly fields. */
export async function listProfiles(): Promise<ListProfilesResult> {
  const list = await profilesRepo.list();
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    dir: p.profileDir,
    isOpen: p.isOpen,
    lastOpenedAt: p.lastOpenedAt?.toISOString() ?? null,
    lastClosedAt: p.lastClosedAt?.toISOString() ?? null,
  }));
}

/**
 * Renames a profile, synchronizing the database and filesystem, with cross-device fallback.
 */
export async function renameProfile(oldName: string, newName: string): Promise<RenameProfileResult> {
  const from = sanitizeName(oldName);
  const to = sanitizeName(newName);
  if (from === to) return { ok: true, from, to };

  return lock.acquire<RenameProfileResult>(`profile:${from}`, async () => {
    try {
      const existing = await profilesRepo.findByName(from);
      if (!existing) throw new Error(ErrorCode.ProfileNotFound);
      if (existing.isOpen) throw new Error(ErrorCode.ProfileIsOpen);
      const collision = await profilesRepo.findByName(to);
      if (collision) throw new Error(ErrorCode.NameTaken);

      const oldDir = existing.profileDir;
      const newDir = resolveDir(to);

      await profilesRepo.rename(existing.id, to, newDir);
      try {
        fs.mkdirSync(path.dirname(newDir), { recursive: true });
        try {
          fs.renameSync(oldDir, newDir);
        } catch (err) {
          if (isErrnoException(err) && err.code === 'EXDEV') {
            const copyDir = (src: string, dest: string) => {
              const entries = fs.readdirSync(src, { withFileTypes: true });
              fs.mkdirSync(dest, { recursive: true });
              for (const entry of entries) {
                const s = path.join(src, entry.name);
                const d = path.join(dest, entry.name);
                if (entry.isDirectory()) copyDir(s, d);
                else fs.copyFileSync(s, d);
              }
            };
            copyDir(oldDir, newDir);
            fs.rmSync(oldDir, { recursive: true, force: true });
          } else {
            throw err;
          }
        }
      } catch (e) {
        await profilesRepo.rename(existing.id, from, oldDir).catch(() => {});
        throw e;
      }

      try { await auditRepo.create(AuditEvent.profile_renamed, { from, to }, existing.id); } catch {}
      return { ok: true, from, to };
    } catch (e) {
      const err = e instanceof Error ? e : new Error('rename_failed');
      const code = isErrorCode(err.message) ? err.message : ErrorCode.FsError;
      return { ok: false, errorCode: code, message: err.message };
    }
  });
}

/** Removes a profile and optionally deletes its storage directory. */
export async function deleteProfile(name: string, opts?: { deleteStorage?: boolean }): Promise<DeleteProfileResult> {
  const safeName = sanitizeName(name);
  return lock.acquire<DeleteProfileResult>(`profile:${safeName}`, async () => {
    try {
      const profile = await profilesRepo.findByName(safeName);
      if (!profile) throw new Error(ErrorCode.ProfileNotFound);
      if (profile.isOpen) throw new Error(ErrorCode.ProfileIsOpen);

      const dir = profile.profileDir;
      await withTransaction(async (tx) => {
        await profilesRepo.remove(profile.id, tx);
      });

      if (opts?.deleteStorage !== false) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      }
      try { await auditRepo.create(AuditEvent.profile_deleted, undefined, profile.id); } catch {}
      return { ok: true };
    } catch (e) {
      const err = e instanceof Error ? e : new Error('delete_failed');
      const code = isErrorCode(err.message) ? err.message : ErrorCode.FsError;
      return { ok: false, errorCode: code, message: err.message };
    }
  });
}
