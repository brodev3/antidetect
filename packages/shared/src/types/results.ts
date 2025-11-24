import type { LaunchSettings } from '../schemas/launchSettings';
import type { FingerprintOptions, ProxyPluginOptions } from '../schemas/options';
import type { ErrorCode } from '../schemas/errors';

export type FailureDTO = { ok: false; errorCode: ErrorCode; message?: string };

export type CreateProfileResult = {
  id: string;
  name: string;
  dir: string;
  normalizedFrom?: string;
  settings: LaunchSettings;
  fingerprint?: { path: string; size: number; sha256: string };
  fingerprintError?: string;
};

export type FingerprintRotateResult =
  | { ok: true; path: string; size: number; sha256: string }
  | FailureDTO;

export type SaveLaunchSettingsResult = {
  id: string;
  name: string;
  settings: {
    headless?: boolean;
    args?: string[];
    fingerprintOptions?: FingerprintOptions;
    proxyPluginOptions?: ProxyPluginOptions;
  };
};

export type SaveLaunchSettingsDTO =
  | ({ ok: true; id: string; name: string } & SaveLaunchSettingsResult & { normalizedFrom?: string })
  | FailureDTO;

export type LaunchSettingsValidationResult =
  | { ok: true; settings: LaunchSettings }
  | { ok: false; error: string };

export type PreviewEffectiveSettingsResult = {
  settings: LaunchSettings;
  source?: {
    presetId?: string | null;
    overridesApplied?: string[];
  };
};

export type ProxySetResult = { ok: true; ip?: string; latencyMs?: number } | FailureDTO;
export type ProxyDeleteResult = { ok: true } | FailureDTO;
export type ProxyCheckResultDTO =
  | { ok: true; ip?: string; latencyMs?: number; country?: string; countryCode?: string }
  | FailureDTO;

export type GetProfileResult = {
  id: string;
  name: string;
  dir: string;
  isOpen: boolean;
  lastOpenedAt?: string | null;
  lastClosedAt?: string | null;
};

export type ListProfilesResult = Array<GetProfileResult>;

export type RenameProfileResult = { ok: true; from: string; to: string } | FailureDTO;
export type DeleteProfileResult = { ok: true } | FailureDTO;

export type OpenProfileResult =
  | { ok: true; profileId: string; name: string }
  | FailureDTO;

export type CloseProfileResult =
  | { ok: true }
  | { ok: false; reason: 'not_open' };



