import type { ProxyType, ProxyEndpoints, ProxyPluginOptions } from './types/proxy';
import type { FingerprintOptions, FetchOptions as FingerprintFetchOptions, Time, Tag } from './types/fingerprint';
export type { ProxyType, ProxyCheckResult, ProxyCheckOptions, ProxyEndpoints, ProxyPluginOptions } from './types/proxy';
export type { FingerprintOptions, FingerprintFetchOptions, Time, Tag } from './types/fingerprint';

export type LaunchOptions = {
  workingDataDir: string;
  profileDir: string;
  useFingerprint: boolean;
  fingerprintOptions?: FingerprintOptions;
  headless?: boolean;
  args?: string[];
  proxy?: {
    type: ProxyType;
    host: string;
    port: number;
    username?: string;
    password?: string;
  };
  proxyPluginOptions?: ProxyPluginOptions;
  proxyCheck?: {
    mode?: 'none' | 'echo' | 'geo+echo';
    expectedCountryCode?: string;
    timeoutMs?: number;
    endpoints?: ProxyEndpoints;
  };
};



