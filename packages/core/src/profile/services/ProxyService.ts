import { profilesRepo, proxyRepo, auditRepo } from '@antidetect/db';
import { sanitizeName, ErrorCode, isErrorCode, AuditEvent, type ProxySetResult, type ProxyDeleteResult, type ProxyCheckResultDTO, type Logger } from '@antidetect/shared';
import type { Proxy as ProxyDTO } from '@antidetect/shared';
import type { ProxyChecker } from '@antidetect/runner';
import type { ProxyPluginOptions } from '@antidetect/shared';
import { lock } from '../utils/locks';
import * as SettingsService from './SettingsService';

interface Deps {
  proxyChecker: ProxyChecker;
  logger?: Logger;
}

export interface ProxySetInput extends ProxyDTO {
  pluginOptions?: ProxyPluginOptions;
}

/**
 * Configures a proxy for the profile, validates connectivity and persists plugin overrides.
 */
export async function setProxy(name: string, input: ProxySetInput, deps: Deps): Promise<ProxySetResult> {
  const safeName = sanitizeName(name);
  return lock.acquire<ProxySetResult>(`proxy:${safeName}`, async () => {
    try {
      const profile = await profilesRepo.findByName(safeName);
      if (!profile) throw new Error(ErrorCode.ProfileNotFound);

      const protocol = input.protocol;
      if (protocol !== 'https' && protocol !== 'socks5') throw new Error(ErrorCode.ProxyUnsupportedType);

      const echo = await deps.proxyChecker.echo(protocol, input.ip, input.port, input.login, input.password);
      if (!echo.ok) throw new Error(ErrorCode.ProxyCheckFailed);

      await proxyRepo.upsertProxy(profile.id, {
        protocol,
        host: input.ip,
        port: input.port,
        login: input.login ?? null,
        password: input.password ?? null,
      });

      await proxyRepo
        .updateMetrics(profile.id, {
          lastCheck: new Date(),
          latencyMs: echo.latencyMs ?? null,
          country: undefined,
        })
        .catch(() => {});

      if (input.pluginOptions) {
        try {
          const current = await SettingsService.getLaunchSettings(safeName);
          const merged = {
            headless: current.settings.headless,
            args: current.settings.args,
            fingerprintOptions: current.settings.fingerprintOptions,
            proxyPluginOptions: {
              ...(current.settings.proxyPluginOptions ?? {}),
              ...(input.pluginOptions ?? {}),
            },
          };
          const saved = await SettingsService.saveLaunchSettings(safeName, merged);
          if (!saved.ok) throw new Error(saved.errorCode);
        } catch {}
      }

      try {
        await auditRepo.create(
          AuditEvent.proxy_set,
          { type: protocol, host: input.ip, port: input.port, latencyMs: echo.latencyMs },
          profile.id,
        );
      } catch {}

      deps.logger?.info('proxy_set', {
        profileId: profile.id,
        type: protocol,
        host: input.ip,
        port: input.port,
        latencyMs: echo.latencyMs,
      });

      return { ok: true, latencyMs: echo.latencyMs, ip: echo.ip };
    } catch (e) {
      const err = e instanceof Error ? e : new Error('proxy_set_failed');
      const code = isErrorCode(err.message) ? err.message : ErrorCode.ProxyCheckFailed;
      deps.logger?.error('proxy_set_failed', { errorCode: code, message: err.message });
      return { ok: false, errorCode: code, message: err.message };
    }
  });
}

/** Removes proxy configuration for the profile. */
export async function deleteProxy(name: string, deps: Deps): Promise<ProxyDeleteResult> {
  const safeName = sanitizeName(name);
  return lock.acquire<ProxyDeleteResult>(`proxy:${safeName}`, async () => {
    try {
      const profile = await profilesRepo.findByName(safeName);
      if (!profile) throw new Error(ErrorCode.ProfileNotFound);

      await proxyRepo.deleteByProfile(profile.id);
      try { await auditRepo.create(AuditEvent.proxy_deleted, undefined, profile.id); } catch {}
      deps.logger?.info('proxy_deleted', { profileId: profile.id });
      return { ok: true };
    } catch (e) {
      const err = e instanceof Error ? e : new Error('proxy_delete_failed');
      const code = isErrorCode(err.message) ? err.message : ErrorCode.ProxyCheckFailed;
      deps.logger?.error('proxy_delete_failed', { errorCode: code, message: err.message });
      return { ok: false, errorCode: code, message: err.message };
    }
  });
}

/**
 * Checks the proxy in echo or geo+echo mode, updating metrics and returning probe details.
 */
export async function checkProxy(
  name: string,
  deps: Deps,
  mode: 'echo' | 'geo+echo' = 'echo',
  expectedCountryCode?: string,
): Promise<ProxyCheckResultDTO> {
  const safeName = sanitizeName(name);
  return lock.acquire<ProxyCheckResultDTO>(`proxy:${safeName}`, async () => {
    try {
      const profile = await profilesRepo.findByName(safeName);
      if (!profile) throw new Error(ErrorCode.ProfileNotFound);

      const existing = await proxyRepo.findByProfile(profile.id);
      if (!existing) return { ok: false, errorCode: ErrorCode.ProxyCheckFailed, message: 'not_set' };
      if (existing.protocol !== 'https' && existing.protocol !== 'socks5') throw new Error(ErrorCode.ProxyUnsupportedType);

      const echo = await deps.proxyChecker.echo(
        existing.protocol,
        existing.host,
        existing.port,
        existing.login ?? undefined,
        existing.password ?? undefined,
      );

      let geo: Awaited<ReturnType<Deps['proxyChecker']['geo']>> | undefined;
      if (mode === 'geo+echo') {
        geo = await deps.proxyChecker.geo(
          existing.protocol,
          existing.host,
          existing.port,
          existing.login ?? undefined,
          existing.password ?? undefined,
          { expectedCountryCode },
        );
      }

      await proxyRepo
        .updateMetrics(profile.id, {
          lastCheck: new Date(),
          latencyMs: echo.latencyMs ?? null,
          country: geo?.country ?? null,
        })
        .catch(() => {});

      const ok = echo.ok && (mode === 'echo' ? true : !!geo?.ok);
      if (!ok) {
        deps.logger?.warn('proxy_check_failed', {
          profileId: profile.id,
          mode,
          echoOk: echo.ok,
          geoOk: geo?.ok,
        });
        return { ok: false, errorCode: ErrorCode.ProxyCheckFailed, message: 'probe_failed' };
      }

      deps.logger?.info('proxy_check_ok', {
        profileId: profile.id,
        ip: echo.ip,
        latencyMs: echo.latencyMs,
        country: geo?.country,
        countryCode: geo?.countryCode,
      });
      return {
        ok: true,
        ip: echo.ip,
        latencyMs: echo.latencyMs,
        country: geo?.country,
        countryCode: geo?.countryCode,
      };
    } catch (e) {
      const err = e instanceof Error ? e : new Error('proxy_check_failed');
      const code = isErrorCode(err.message) ? err.message : ErrorCode.ProxyCheckFailed;
      deps.logger?.error('proxy_check_failed', { errorCode: code, message: err.message });
      return { ok: false, errorCode: code, message: err.message };
    }
  });
}
