import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { profilesRepo, fpMetaRepo, auditRepo } from '@antidetect/db';
import { ErrorCode, AuditEvent, isErrorCode, type FingerprintRotateResult, type Logger } from '@antidetect/shared';
import { fetchFingerprint, type FingerprintFetchOptions } from '@antidetect/runner';
import { lock } from '../utils/locks';

interface Deps {
  logger?: Logger;
}

/**
 * Fetches a fresh fingerprint, writes it to disk atomically and updates metadata records.
 */
export async function rotateFingerprint(name: string, fetch: FingerprintFetchOptions, deps?: Deps): Promise<FingerprintRotateResult> {
  return lock.acquire(`fp:${name}`, async () => {
    try {
      const profile = await profilesRepo.findByName(name);
      if (!profile) throw new Error(ErrorCode.ProfileNotFound);
      const dir = profile.profileDir;
      if (!dir || !fs.existsSync(dir)) throw new Error(ErrorCode.ProfileStorageNotFound);

      const tmp = path.join(dir, 'fp.json.tmp');
      const finalPath = path.join(dir, 'fp.json');
      let data = '';
      try {
        data = await fetchFingerprint(fetch);
        fs.writeFileSync(tmp, data, 'utf-8');
        fs.renameSync(tmp, finalPath);
      } catch (e) {
        try {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch {}
        throw e;
      }

      const size = Buffer.byteLength(data, 'utf-8');
      const sha256 = crypto.createHash('sha256').update(data).digest('hex');

      let ua: string | undefined;
      let browser: string | undefined;
      let os: string | undefined;
      try {
        const parsed = JSON.parse(data);
        ua = parsed?.userAgent ?? parsed?.navigator?.userAgent;
        browser = parsed?.browser?.name ?? parsed?.navigator?.appName;
        os = parsed?.os?.name ?? parsed?.platform;
      } catch {}

      await fpMetaRepo.upsertMeta(profile.id, {
        sha256,
        size,
        userAgent: ua ?? null,
        browser: browser ?? null,
        os: os ?? null,
        fetchOptions: fetch ? JSON.stringify(fetch) : null,
        fingerprintOptions: null,
      });

      try {
        await auditRepo.create(AuditEvent.fingerprint_rotated, { sha256, size }, profile.id);
      } catch {}

      deps?.logger?.info('fingerprint_rotated', { profileId: profile.id, sha256, size });
      return { ok: true, path: finalPath, size, sha256 } as const;
    } catch (e) {
      const err = e instanceof Error ? e : new Error('fingerprint_failed');
      const code = isErrorCode(err.message) ? err.message : ErrorCode.FingerprintFailed;
      deps?.logger?.error('fingerprint_rotate_failed', { errorCode: code, message: err.message });
      return { ok: false, errorCode: code, message: err.message } as const;
    }
  });
}
