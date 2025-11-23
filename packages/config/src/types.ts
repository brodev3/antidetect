import type { FingerprintFetchOptions } from '@antidetect/runner';

/** Shape of the validated application configuration exposed to consumers. */
export type AppConfig = Readonly<{
  storageDir: string;
  proxyCheck: { echoUrl: string; geoUrl: string; timeoutMs: number };
  runner: { serviceKey: string; engineDir: string; requestTimeoutMs: number; engineTimeoutMs: number };
  fingerprintDefaults: Readonly<FingerprintFetchOptions>;
}>;
