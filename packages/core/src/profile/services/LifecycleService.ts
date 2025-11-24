import fs from 'fs';
import path from 'path';
import { config } from '@antidetect/config';
import { profilesRepo, settingsRepo, proxyRepo, auditRepo } from '@antidetect/db';
import type { FingerprintOptions, ProxyPluginOptions, RunnerContext, Runner as RunnerType, ProxyChecker as ProxyCheckerType, LaunchOptions } from '@antidetect/runner';
import { ErrorCode, AuditEvent, type OpenProfileResult, type CloseProfileResult, type Logger } from '@antidetect/shared';
import { lock } from '../utils/locks';
import * as ProxyService from './ProxyService';

type Deps = {
  runner: typeof RunnerType;
  proxyChecker: ProxyCheckerType;
  active: Map<string, RunnerContext>;
  logger?: Logger;
};

const raceWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number, errorFactory: () => Error): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return (await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(errorFactory()), timeoutMs);
      }),
    ])) as T;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

/**
 * Opens a profile by validating prerequisites, launching the runner and returning a structured result.
 */
export async function openProfile(
  name: string,
  deps: Deps,
  opts?: { timeoutMs?: number },
): Promise<OpenProfileResult> {
  return lock.acquire(`open:${name}`, async () => {
    const profile = await profilesRepo.findByName(name);
    if (!profile) throw new Error(ErrorCode.ProfileNotFound);

    const existing = deps.active.get(profile.id);
    if (existing) return { ok: true, profileId: profile.id, name: profile.name } as const;

    const profileDir = profile.profileDir;
    if (!profileDir || !fs.existsSync(profileDir)) throw new Error(ErrorCode.ProfileStorageNotFound);

    const settings = await settingsRepo.getSettings(profile.id);
    if (!settings) throw new Error(ErrorCode.SettingsNotFound);

    const parse = <T>(s?: string | null) => (s ? (JSON.parse(s) as T) : undefined);
    const args = parse<string[]>(settings.args) ?? [];
    const fingerprintOptions = parse<FingerprintOptions>(settings.fingerprintOptions);
    const proxyPluginOptions = parse<ProxyPluginOptions>(settings.proxyPluginOptions);
    const headless = settings.headless ?? false;

    const dbProxy = await proxyRepo.findByProfile(profile.id);
    let proxy: { type: 'https' | 'socks5'; host: string; port: number; username?: string; password?: string } | undefined;
    if (dbProxy) {
      if (dbProxy.protocol !== 'https' && dbProxy.protocol !== 'socks5') throw new Error(ErrorCode.ProxyUnsupportedType);
      proxy = {
        type: dbProxy.protocol,
        host: dbProxy.host,
        port: dbProxy.port,
        username: dbProxy.login ?? undefined,
        password: dbProxy.password ?? undefined,
      };
      const check = await ProxyService.checkProxy(profile.name, { proxyChecker: deps.proxyChecker }, 'echo');
      if (!check.ok) throw new Error(ErrorCode.ProxyCheckFailed);
    }

    const timeoutMs = opts?.timeoutMs ?? config.runner.engineTimeoutMs;

    const attempt = async (): Promise<RunnerContext> => {
      let browser: RunnerContext | null = null;
      try {
        const launchOptions: LaunchOptions = {
          workingDataDir: config.runner.engineDir,
          profileDir,
          useFingerprint: fs.existsSync(path.join(profileDir, 'fp.json')),
          fingerprintOptions,
          proxyPluginOptions,
          proxy,
          headless,
          args,
        };
        const launchPromise = deps.runner.launch(launchOptions) as Promise<RunnerContext>;
        browser = await raceWithTimeout(launchPromise, timeoutMs, () => new Error(ErrorCode.LaunchTimeout));
        return browser;
      } catch (e) {
        try { await browser?.close(); } catch {}
        throw e;
      }
    };

    try {
      const browser = await attempt();
      deps.active.set(profile.id, browser);
      try { await profilesRepo.setOpenState(profile.id, true); } catch {}
      try { await auditRepo.create(AuditEvent.profile_opened, undefined, profile.id); } catch {}
      deps.logger?.info('profile_opened', { profileId: profile.id, name: profile.name });
      return { ok: true, profileId: profile.id, name: profile.name } as const;
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error(ErrorCode.LaunchFailed);
      const msg = err.message || 'launch_failed';
      let code: ErrorCode = ErrorCode.LaunchFailed;
      switch (msg) {
        case ErrorCode.ProfileNotFound:
          code = ErrorCode.ProfileNotFound;
          break;
        case ErrorCode.SettingsNotFound:
          code = ErrorCode.SettingsNotFound;
          break;
        case ErrorCode.ProfileStorageNotFound:
          code = ErrorCode.ProfileStorageNotFound;
          break;
        case ErrorCode.ProxyUnsupportedType:
          code = ErrorCode.ProxyUnsupportedType;
          break;
        case ErrorCode.ProxyCheckFailed:
          code = ErrorCode.ProxyCheckFailed;
          break;
        case ErrorCode.LaunchTimeout:
          code = ErrorCode.LaunchTimeout;
          break;
        case ErrorCode.LaunchFailed:
          code = ErrorCode.LaunchFailed;
          break;
        default:
          code = ErrorCode.LaunchFailed;
          break;
      }
      deps.logger?.error('profile_open_failed', { profileId: profile.id, errorCode: code, message: msg });
      return { ok: false, errorCode: code, message: msg } as const;
    }
  });
}

/** Gracefully closes an active profile and persists the new state. */
export async function closeProfile(name: string, deps: Deps): Promise<CloseProfileResult> {
  return lock.acquire(`open:${name}`, async () => {
    const profile = await profilesRepo.findByName(name);
    if (!profile) throw new Error(ErrorCode.ProfileNotFound);
    const ctx = deps.active.get(profile.id);
    if (!ctx) return { ok: false, reason: 'not_open' } as const;
    try { await ctx.close(); } catch {}
    deps.active.delete(profile.id);
    try { await profilesRepo.setOpenState(profile.id, false); } catch {}
    try { await auditRepo.create(AuditEvent.profile_closed, undefined, profile.id); } catch {}
    deps.logger?.info('profile_closed', { profileId: profile.id, name: profile.name });
    return { ok: true } as const;
  });
}
