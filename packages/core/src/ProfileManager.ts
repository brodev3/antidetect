import path from 'path';
import { config } from '@antidetect/config';
import { profilesRepo, settingsRepo } from '@antidetect/db';
import { Runner, ProxyChecker, type RunnerContext, type FingerprintOptions, type ProxyPluginOptions, type FingerprintFetchOptions } from '@antidetect/runner';
import {
  ProfileCreateSchema,
  type ProfileCreate,
  sanitizeName,
  tryParseJson,
  type CreateProfileResult,
  type FingerprintRotateResult,
  type SaveLaunchSettingsResult,
  type SaveLaunchSettingsDTO,
  type LaunchSettingsValidationResult,
  type OpenProfileResult,
  type CloseProfileResult,
  type ProxySetResult,
  type ProxyDeleteResult,
  type ProxyCheckResultDTO,
  type GetProfileResult,
  type ListProfilesResult,
  type RenameProfileResult,
  type DeleteProfileResult,
  ErrorCode,
  LaunchSettingsSchema,
} from '@antidetect/shared';
import type { Logger } from '@antidetect/shared';
import { ConsoleLogger } from './profile/utils/logger';
import * as TemplateService from './profile/services/TemplateService';
import type { TemplateSummary } from './profile/services/TemplateService';
import * as SettingsService from './profile/services/SettingsService';
import * as LifecycleService from './profile/services/LifecycleService';
import * as FingerprintService from './profile/services/FingerprintService';
import * as ProxyService from './profile/services/ProxyService';
import * as CreationService from './profile/services/CreationService';
import * as AdminService from './profile/services/AdminService';

/**
 * Primary facade for profile lifecycle management: creation, storage, fingerprint rotation,
 * proxy orchestration and runner coordination.
 */
export class ProfileManager {
  private active = new Map<string, RunnerContext>();
  private proxyChecker = new ProxyChecker({
    timeoutMs: config.proxyCheck.timeoutMs,
    endpoints: { echoUrl: config.proxyCheck.echoUrl, geoUrl: config.proxyCheck.geoUrl },
  });
  private runner: typeof Runner;
  private logger: Logger;

  constructor(runner?: typeof Runner, logger?: Logger) {
    this.runner = runner ?? Runner;
    this.runner.configure(config.runner);
    this.logger = logger ?? new ConsoleLogger({ service: 'ProfileManager' });
  }

  async saveTemplate(name: string, settings: unknown, setDefault = false): Promise<TemplateSummary> {
    return TemplateService.saveTemplate(name, settings, setDefault);
  }

  async listTemplates(): Promise<TemplateSummary[]> {
    return TemplateService.listTemplates();
  }

  async setDefaultTemplate(id: string): Promise<TemplateSummary> {
    return TemplateService.setDefaultTemplate(id);
  }

  async applyTemplateToProfile(profileName: string, templateId: string): Promise<SaveLaunchSettingsResult> {
    return TemplateService.applyTemplateToProfile(profileName, templateId);
  }

  async getLaunchSettings(name: string): Promise<SaveLaunchSettingsResult> {
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

  async validateSettings(settings: unknown): Promise<LaunchSettingsValidationResult> {
    try {
      const dto = LaunchSettingsSchema.parse(settings);
      return { ok: true, settings: dto };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'validation_failed';
      return { ok: false, error: msg };
    }
  }

  private resolveDir(name: string): string {
    return path.resolve(config.storageDir, `profiles/${name}`);
  }

  async createProfile(input: ProfileCreate): Promise<CreateProfileResult> {
    const dto: ProfileCreate = ProfileCreateSchema.parse(input);
    const inputName = dto.name;
    const safeName = sanitizeName(inputName);
    const nameChanged = safeName !== inputName;
    const created = await CreationService.createProfile(dto);
    let fingerprint: { path: string; size: number; sha256: string } | undefined;
    let fingerprintError: string | undefined;
    if (dto.generateOnCreate) {
      const fpRes = await this.rotateFingerprint(safeName, dto.fingerprint?.fetch);
      if (fpRes?.ok) {
        fingerprint = { path: fpRes.path, size: fpRes.size, sha256: fpRes.sha256 };
      } else {
        const errRes = fpRes as Extract<FingerprintRotateResult, { ok: false }>;
        fingerprintError = errRes.message ?? errRes.errorCode;
      }
    }
    return { id: created.id, name: safeName, dir: created.dir, normalizedFrom: nameChanged ? inputName : undefined, settings: dto.settings, fingerprint, fingerprintError };
  }

  async saveLaunchSettings(name: string, settings: unknown): Promise<SaveLaunchSettingsDTO> {
    return SettingsService.saveLaunchSettings(name, settings, { logger: this.logger });
  }

  async openProfile(name: string, opts?: { timeoutMs?: number }): Promise<OpenProfileResult> {
    return LifecycleService.openProfile(name, { runner: this.runner, proxyChecker: this.proxyChecker, active: this.active, logger: this.logger }, opts);
  }

  async closeProfile(name: string): Promise<CloseProfileResult> {
    return LifecycleService.closeProfile(name, { runner: this.runner, proxyChecker: this.proxyChecker, active: this.active, logger: this.logger });
  }

  async rotateFingerprint(name: string, fetch?: FingerprintFetchOptions): Promise<FingerprintRotateResult> {
    const preset = config.fingerprintDefaults;
    const merged: FingerprintFetchOptions = { ...preset, ...(fetch ?? {}) };
    return FingerprintService.rotateFingerprint(name, merged, { logger: this.logger });
  }

  async setProxy(name: string, proxy: ProxyService.ProxySetInput): Promise<ProxySetResult> {
    return ProxyService.setProxy(name, proxy, { proxyChecker: this.proxyChecker, logger: this.logger });
  }

  async deleteProxy(name: string): Promise<ProxyDeleteResult> {
    return ProxyService.deleteProxy(name, { proxyChecker: this.proxyChecker, logger: this.logger });
  }

  async checkProxy(name: string, mode: 'echo' | 'geo+echo' = 'echo', expectedCountryCode?: string): Promise<ProxyCheckResultDTO> {
    return ProxyService.checkProxy(name, { proxyChecker: this.proxyChecker, logger: this.logger }, mode, expectedCountryCode);
  }

  async getProfile(name: string): Promise<GetProfileResult> {
    return AdminService.getProfile(name);
  }

  async listProfiles(): Promise<ListProfilesResult> {
    return AdminService.listProfiles();
  }

  async renameProfile(oldName: string, newName: string): Promise<RenameProfileResult> {
    return AdminService.renameProfile(oldName, newName);
  }

  async deleteProfile(name: string, opts?: { deleteStorage?: boolean }): Promise<DeleteProfileResult> {
    return AdminService.deleteProfile(name, opts);
  }
}
