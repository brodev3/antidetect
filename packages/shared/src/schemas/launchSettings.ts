import { z } from 'zod';
import { FingerprintOptionsSchema, ProxyPluginOptionsSchema } from './options';

/** Shape of runtime launch configuration used by the core services. */
export const LaunchSettingsSchema = z.object({
  headless: z.boolean().optional(),
  args: z.array(z.string()).optional(),
  fingerprintOptions: FingerprintOptionsSchema.optional(),
  proxyPluginOptions: ProxyPluginOptionsSchema.optional(),
});

export type LaunchSettings = z.infer<typeof LaunchSettingsSchema>;



