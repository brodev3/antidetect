import 'dotenv/config';
import { z } from 'zod';
import path from 'path';
import type { AppConfig } from './types';
import { defaultFingerprintPreset } from './defaults/fingerprint';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('test'),
  ECHO_URL: z.string().url().optional().default('http://ip.bablosoft.com/'),
  GEO_URL: z.string().url().optional().default('http://ip-api.com/json'),
  PROXY_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),
  SERVICE_KEY: z.string().optional().default(''),
  FP_SWITCHER_KEY: z.string().optional().default(''),
  ENGINE_DIR: z.string().optional().default('engine'),
  PLUGIN_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(5 * 60_000),
  PLUGIN_ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(10 * 60_000),
});

/** Loads configuration from environment variables and validates it with Zod. */
export function loadConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${JSON.stringify(parsed.error.flatten())}`);
  }
  const env = parsed.data;

  const proxyCheck = { echoUrl: env.ECHO_URL, geoUrl: env.GEO_URL, timeoutMs: env.PROXY_CHECK_TIMEOUT_MS };
  const storageDir = path.resolve(process.cwd(), 'storage');
  const runner = {
    serviceKey: env.SERVICE_KEY || env.FP_SWITCHER_KEY || '',
    engineDir: path.resolve(process.cwd(), env.ENGINE_DIR || 'engine'),
    requestTimeoutMs: env.PLUGIN_REQUEST_TIMEOUT_MS,
    engineTimeoutMs: env.PLUGIN_ENGINE_TIMEOUT_MS,
  };

  return Object.freeze({ storageDir, proxyCheck, runner, fingerprintDefaults: defaultFingerprintPreset });
}

/** Frozen singleton configuration evaluated at process start. */
export const config: AppConfig = loadConfig();
