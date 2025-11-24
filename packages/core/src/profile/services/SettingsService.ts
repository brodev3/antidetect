import { profilesRepo, settingsRepo, auditRepo } from '@antidetect/db';
import {
  LaunchSettingsSchema,
  ErrorCode,
  AuditEvent,
  isErrorCode,
  sanitizeName,
  tryParseJson,
  serializeArgs,
  serializeJson,
  type SaveLaunchSettingsResult,
  type SaveLaunchSettingsDTO,
  type LaunchSettingsValidationResult,
} from '@antidetect/shared';
import type { FingerprintOptions, ProxyPluginOptions } from '@antidetect/runner';
import { lock } from '../utils/locks';
import type { Logger } from '@antidetect/shared';

interface Deps {
  logger?: Logger;
}

/**
 * Persists launch settings after validation and records an audit trail.
 */
export async function saveLaunchSettings(name: string, settings: unknown, deps?: Deps): Promise<SaveLaunchSettingsDTO> {
  const inputName = name;
  const safeName = sanitizeName(name);
  const nameChanged = safeName !== inputName;
  return lock.acquire(`settings:${safeName}`, async () => {
    try {
      const profile = await profilesRepo.findByName(safeName);
      if (!profile) throw new Error(ErrorCode.ProfileNotFound);

      const dto = LaunchSettingsSchema.parse(settings);
      try {
        await settingsRepo.upsertSettings(profile.id, {
          headless: dto.headless ?? false,
          args: serializeArgs(dto.args),
          fingerprintOptions: serializeJson(dto.fingerprintOptions),
          proxyPluginOptions: serializeJson(dto.proxyPluginOptions),
        });
      } catch {
        throw new Error(ErrorCode.SettingsSaveFailed);
      }

      try {
        await auditRepo.create(AuditEvent.settings_saved, { keys: Object.keys(dto) }, profile.id);
      } catch {}
      deps?.logger?.info('settings_saved', { profileId: profile.id, keys: Object.keys(dto) });

      const saved = await settingsRepo.getSettings(profile.id);
      const normalized: SaveLaunchSettingsResult['settings'] = {
        headless: saved?.headless ?? false,
        args: tryParseJson<string[]>(saved?.args) ?? [],
        fingerprintOptions: tryParseJson<FingerprintOptions>(saved?.fingerprintOptions),
        proxyPluginOptions: tryParseJson<ProxyPluginOptions>(saved?.proxyPluginOptions),
      };
      const success: SaveLaunchSettingsDTO = {
        ok: true,
        id: profile.id,
        name: profile.name,
        settings: normalized,
        normalizedFrom: nameChanged ? inputName : undefined,
      };
      return success;
    } catch (e) {
      const err = e instanceof Error ? e : new Error('settings_save_failed');
      const code = isErrorCode(err.message) ? err.message : ErrorCode.SettingsSaveFailed;
      deps?.logger?.error('settings_save_failed', { errorCode: code, message: err.message });
      return { ok: false as const, errorCode: code, message: err.message };
    }
  });
}

/** Retrieves previously saved launch settings for a profile. */
export async function getLaunchSettings(name: string): Promise<SaveLaunchSettingsResult> {
  const safeName = sanitizeName(name);
  const profile = await profilesRepo.findByName(safeName);
  if (!profile) throw new Error(ErrorCode.ProfileNotFound);

  const saved = await settingsRepo.getSettings(profile.id);
  if (!saved) throw new Error(ErrorCode.SettingsNotFound);

  return {
    id: profile.id,
    name: profile.name,
    settings: {
      headless: saved.headless ?? false,
      args: tryParseJson<string[]>(saved.args) ?? [],
      fingerprintOptions: tryParseJson<FingerprintOptions>(saved.fingerprintOptions),
      proxyPluginOptions: tryParseJson<ProxyPluginOptions>(saved.proxyPluginOptions),
    },
  };
}

/** Validates launch settings without mutating any state. */
export async function validateSettings(settings: unknown): Promise<LaunchSettingsValidationResult> {
  try {
    const dto = LaunchSettingsSchema.parse(settings);
    return { ok: true, settings: dto };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'validation_failed';
    return { ok: false, error: msg };
  }
}
