import { z } from 'zod';
import { ProxySchema } from './proxy';
import { LaunchSettingsSchema } from './launchSettings';
import { FingerprintOptionsSchema, ProxyPluginOptionsSchema } from './options';

/** Supported time ranges for fingerprint fetching presets. */
export const FingerprintTimeSchema = z.union([
  z.literal('*'),
  z.literal('15 days'),
  z.literal('30 days'),
  z.literal('60 days'),
]);

/** Preset tags that narrow the fingerprint search. */
export const FingerprintTagSchema = z.enum([
  '*',
  'Desktop',
  'Mobile',
  'Microsoft Windows',
  'Apple Mac',
  'Android',
  'Linux',
  'iPad',
  'iPhone',
  'Edge',
  'Chrome',
  'Safari',
  'Firefox',
  'YaBrowser',
  'Windows 7',
  'Windows 8',
  'Windows 10',
]);

/** Minimal set of options required to request a fingerprint from the upstream service. */
export const FingerprintFetchSchema = z
  .object({
    tags: z.array(FingerprintTagSchema).optional(),
    timeLimit: FingerprintTimeSchema.optional(),
    minWidth: z.number().int().positive().optional(),
    maxWidth: z.number().int().positive().optional(),
    minHeight: z.number().int().positive().optional(),
    maxHeight: z.number().int().positive().optional(),
    minBrowserVersion: z.union([z.number().int().positive(), z.literal('current')]).optional(),
    maxBrowserVersion: z.union([z.number().int().positive(), z.literal('current')]).optional(),
    perfectCanvasLogs: z.boolean().optional(),
    perfectCanvasRequest: z.string().optional(),
    enableCustomServer: z.boolean().optional(),
    dynamicPerfectCanvas: z.boolean().optional(),
    enablePrecomputedFingerprints: z.boolean().optional(),
  })
  .partial();

/** Fingerprint-specific overrides that may accompany profile creation. */
export const FingerprintCreateSchema = z.object({
  fetch: FingerprintFetchSchema.optional(),
  options: FingerprintOptionsSchema.optional(),
});

/** Optional proxy validation behaviour applied during profile creation. */
export const ProxyCheckSchema = z
  .object({
    mode: z.enum(['echo', 'geo+echo']).default('echo').optional(),
    expectedCountryCode: z.string().length(2).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .partial();

/** Proxy payload accepted when creating a profile via the API. */
export const ProxyCreateSchema = ProxySchema.extend({
  pluginOptions: ProxyPluginOptionsSchema.optional(),
  check: ProxyCheckSchema.optional(),
});

/** Main DTO describing what is needed to create a profile. */
export const ProfileCreateSchema = z.object({
  name: z.string().min(1),
  settings: LaunchSettingsSchema,
  fingerprint: FingerprintCreateSchema.optional(),
  generateOnCreate: z.boolean().optional().default(false),
  proxy: ProxyCreateSchema.optional(),
  presetId: z.string().optional(),
  dryRun: z.boolean().optional().default(false),
});

export type ProfileCreate = z.infer<typeof ProfileCreateSchema>;



