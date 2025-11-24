import { templatesRepo, profilesRepo, settingsRepo } from '@antidetect/db';
import {
  LaunchSettingsSchema,
  serializeJson,
  serializeArgs,
  tryParseJson,
  sanitizeName,
  ErrorCode,
} from '@antidetect/shared';
import type { SaveLaunchSettingsResult } from '@antidetect/shared';
import type { FingerprintOptions, ProxyPluginOptions } from '@antidetect/runner';
import { lock } from '../utils/locks';

export interface TemplateSummary {
  id: string;
  name: string;
  isDefault: boolean;
}

/** Saves a launch settings template and optionally marks it as default. */
export async function saveTemplate(name: string, settings: unknown, setDefault = false): Promise<TemplateSummary> {
  const dto = LaunchSettingsSchema.parse(settings);
  const json = serializeJson(dto) ?? '{}';
  const tpl = await templatesRepo.upsertTemplate(name, json, setDefault);
  return { id: tpl.id, name: tpl.name, isDefault: tpl.isDefault };
}

/** Returns available templates for selection. */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const rows = await templatesRepo.list();
  return rows.map((r) => ({ id: r.id, name: r.name, isDefault: r.isDefault }));
}

/** Marks the provided template as the default preset. */
export async function setDefaultTemplate(id: string): Promise<TemplateSummary> {
  const tpl = await templatesRepo.setDefault(id);
  return { id: tpl.id, name: tpl.name, isDefault: tpl.isDefault };
}

/** Applies a template to a profile and returns the materialized settings. */
export async function applyTemplateToProfile(profileName: string, templateId: string): Promise<SaveLaunchSettingsResult> {
  const safeName = sanitizeName(profileName);
  return lock.acquire(`settings:${safeName}`, async () => {
    const profile = await profilesRepo.findByName(safeName);
    if (!profile) throw new Error(ErrorCode.ProfileNotFound);

    const tpl = await templatesRepo.findById(templateId);
    if (!tpl) throw new Error(ErrorCode.TemplateNotFound);

    const dto = LaunchSettingsSchema.parse(JSON.parse(tpl.settings));
    await settingsRepo.upsertSettings(profile.id, {
      headless: dto.headless ?? false,
      args: serializeArgs(dto.args),
      fingerprintOptions: serializeJson(dto.fingerprintOptions),
      proxyPluginOptions: serializeJson(dto.proxyPluginOptions),
    });

    const saved = await settingsRepo.getSettings(profile.id);
    return {
      id: profile.id,
      name: profile.name,
      settings: {
        headless: saved?.headless ?? false,
        args: tryParseJson<string[]>(saved?.args) ?? [],
        fingerprintOptions: tryParseJson<FingerprintOptions>(saved?.fingerprintOptions),
        proxyPluginOptions: tryParseJson<ProxyPluginOptions>(saved?.proxyPluginOptions),
      },
    };
  });
}
