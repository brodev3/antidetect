import fs from 'fs';
import { withTransaction, profilesRepo, settingsRepo } from '@antidetect/db';
import { resolveProfileDir } from '../utils/paths';
import { sanitizeName, serializeArgs, serializeJson, ErrorCode } from '@antidetect/shared';
import { ProfileCreateSchema, type ProfileCreate } from '@antidetect/shared';

type CreatedProfileRecord = {
  id: string;
  name: string;
  dir: string;
  settings: ProfileCreate['settings'];
};

function resolveDir(name: string): string {
  return resolveProfileDir(name);
}

/**
 * Creates a profile record in the database and prepares its storage directory.
 * Validation, uniqueness checks and filesystem rollback are handled internally.
 */
export async function createProfile(input: ProfileCreate): Promise<CreatedProfileRecord> {
  const dto = ProfileCreateSchema.parse(input);
  const inputName = dto.name;
  const safeName = sanitizeName(inputName);
  const dir = resolveDir(safeName);

  const existing = await profilesRepo.findByName(safeName);
  if (existing) throw new Error(ErrorCode.NameTaken);
  if (fs.existsSync(dir)) throw new Error(ErrorCode.ProfileDirExists);

  let profileId = '';
  const created = await withTransaction(async (tx) => {
    const p = await profilesRepo.createProfile(safeName, dir, tx);
    await settingsRepo.upsertSettings(
      p.id,
      {
        headless: dto.settings.headless ?? false,
        args: serializeArgs(dto.settings.args),
        fingerprintOptions: serializeJson(dto.settings.fingerprintOptions),
        proxyPluginOptions: serializeJson(dto.settings.proxyPluginOptions),
      },
      tx,
    );
    return p;
  });
  profileId = created.id;

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    try {
      await withTransaction(async (tx) => {
        await tx.settings.delete({ where: { profileId } }).catch(() => {});
        await tx.fingerprintMeta.deleteMany({ where: { profileId } }).catch(() => {});
        await tx.profile.delete({ where: { id: profileId } }).catch(() => {});
      });
    } catch {}
    throw new Error(ErrorCode.FsError);
  }

  return { id: profileId, name: safeName, dir, settings: dto.settings };
}
