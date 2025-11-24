import { z } from 'zod';

/** Settings that fine-tune how a fingerprint should be applied inside the runner. */
export const FingerprintOptionsSchema = z
  .object({
    emulateDeviceScaleFactor: z.boolean().optional(),
    emulateSensorAPI: z.boolean().optional(),
    usePerfectCanvas: z.boolean().optional(),
    useFontPack: z.boolean().optional(),
    safeElementSize: z.boolean().optional(),
    safeBattery: z.boolean().optional(),
    safeCanvas: z.boolean().optional(),
    safeAudio: z.boolean().optional(),
    safeWebGL: z.boolean().optional(),
  })
  .partial();

/**
 * Options understood by the Playwright proxy plugin. Most fields are optional toggles or presets.
 */
export const ProxyPluginOptionsSchema = z
  .object({
    changeBrowserLanguage: z.boolean().optional(),
    changeGeolocation: z.boolean().optional(),
    changeTimezone: z.boolean().optional(),
    changeWebRTC: z.enum(['enable', 'disable', 'replace']).optional(),
    publicIPv4: z
      .union([
        z.literal('auto'),
        z.string(),
        z.object({ v4: z.union([z.literal('auto'), z.string()]) }),
      ])
      .optional(),
    publicIPv6: z
      .union([
        z.literal('auto'),
        z.string(),
        z.object({ v6: z.union([z.literal('auto'), z.string()]) }),
      ])
      .optional(),
    privateIPv4: z
      .union([
        z.literal('local'),
        z.literal('private class a'),
        z.literal('private class b'),
        z.literal('private class c'),
        z.string(),
      ])
      .optional(),
    privateIPv6: z
      .union([z.literal('local'), z.literal('unique local address'), z.string()])
      .optional(),
    ipExtractionMethod: z
      .union([
        z.literal('raw'),
        z.literal('regexp'),
        z.literal('jsonpath'),
        z.string(),
        z.object({ v4: z.string(), v6: z.string() }),
      ])
      .optional(),
    ipExtractionParam: z
      .union([z.string(), z.object({ v4: z.string(), v6: z.string() })])
      .optional(),
    ipExtractionURL: z
      .union([z.string(), z.object({ v4: z.string(), v6: z.string() })])
      .optional(),
    detectExternalIP: z
      .union([z.boolean(), z.object({ v4: z.boolean(), v6: z.boolean() })])
      .optional(),
    ipInfoMethod: z.enum(['database', 'ip-api.com']).optional(),
    ipInfoKey: z.string().optional(),
    enableTunneling: z.boolean().optional(),
    enableQUIC: z.boolean().optional(),
    dnsMode: z.enum(['system-proxy', 'custom-proxy', 'custom-direct']).optional(),
    dnsIP: z.string().optional(),
  })
  .partial();

export type FingerprintOptions = z.infer<typeof FingerprintOptionsSchema>;
export type ProxyPluginOptions = z.infer<typeof ProxyPluginOptionsSchema>;



