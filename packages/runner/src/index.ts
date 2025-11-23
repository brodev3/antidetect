import fs from 'fs';
import path from 'path';
import { plugin as basePlugin } from 'playwright-with-fingerprints';
import type { LaunchOptions, FingerprintOptions, ProxyPluginOptions } from './types';
export { ProxyChecker } from './lib/proxy';
export * from './types';
export * from './lib/fingerprint';

export interface RunnerContext {
  close(): Promise<void>;
}

interface FingerprintPluginApi {
  setWorkingFolder(directory: string): void;
  setServiceKey(key: string): void;
  setRequestTimeout(timeoutMs: number): void;
  setEngineTimeout?(timeoutMs: number): void;
  useProfile(directory: string, options: { loadFingerprint: boolean; loadProxy: boolean }): void;
  useFingerprint(fingerprintJson: string, options: FingerprintOptions): void;
  launchPersistentContext(
    directory: string,
    options: { headless?: boolean; args?: string[]; ignoreDefaultArgs?: string[] },
  ): Promise<RunnerContext>;
  setChangeBrowserLanguage?(value: boolean): void;
  setChangeGeolocation?(value: boolean): void;
  setChangeTimezone?(value: boolean): void;
  setChangeWebRTC?(mode: ProxyPluginOptions['changeWebRTC']): void;
  setPublicIPv4?(value: ProxyPluginOptions['publicIPv4']): void;
  setPublicIPv6?(value: ProxyPluginOptions['publicIPv6']): void;
  setPrivateIPv4?(value: ProxyPluginOptions['privateIPv4']): void;
  setPrivateIPv6?(value: ProxyPluginOptions['privateIPv6']): void;
  setIPExtractionMethod?(value: ProxyPluginOptions['ipExtractionMethod']): void;
  setIPExtractionParam?(value: ProxyPluginOptions['ipExtractionParam']): void;
  setIPExtractionURL?(value: ProxyPluginOptions['ipExtractionURL']): void;
  setDetectExternalIP?(value: ProxyPluginOptions['detectExternalIP']): void;
  setIPInfoMethod?(value: ProxyPluginOptions['ipInfoMethod']): void;
  setIPInfoKey?(value: ProxyPluginOptions['ipInfoKey']): void;
  setEnableTunneling?(value: ProxyPluginOptions['enableTunneling']): void;
  setEnableQUIC?(value: ProxyPluginOptions['enableQUIC']): void;
  setDNSMode?(value: ProxyPluginOptions['dnsMode']): void;
  setDNSIP?(value: ProxyPluginOptions['dnsIP']): void;
}

const plugin: FingerprintPluginApi = basePlugin as unknown as FingerprintPluginApi;

/** Static helper that wires the fingerprint runner with Playwright integrations. */
export class Runner {
  static configure(options?: {
    serviceKey?: string;
    engineDir?: string;
    requestTimeoutMs?: number;
    engineTimeoutMs?: number;
  }): void {
    const engineDir = options?.engineDir ?? path.resolve(process.cwd(), 'engine');
    if (!fs.existsSync(engineDir)) fs.mkdirSync(engineDir, { recursive: true });
    plugin.setWorkingFolder(engineDir);
    if (options?.serviceKey !== undefined) plugin.setServiceKey(options.serviceKey);
    if (options?.requestTimeoutMs !== undefined) plugin.setRequestTimeout(options.requestTimeoutMs);
    if (options?.engineTimeoutMs !== undefined) plugin.setEngineTimeout?.(options.engineTimeoutMs);
  }

  static async launch(options: LaunchOptions): Promise<RunnerContext> {
    plugin.useProfile(options.profileDir, {
      loadFingerprint: false,
      loadProxy: false,
    });

    if (options.useFingerprint) {
      const fpContent = fs.readFileSync(path.join(options.profileDir, 'fp.json'), 'utf-8');
      const fpOptions: FingerprintOptions = {
        safeElementSize: true,
        ...(options.fingerprintOptions ?? {}),
      };
      plugin.useFingerprint(fpContent, fpOptions);
    }

    if (options.proxyPluginOptions) {
      const o: ProxyPluginOptions = options.proxyPluginOptions;
      if (o.changeBrowserLanguage !== undefined) plugin.setChangeBrowserLanguage?.(o.changeBrowserLanguage);
      if (o.changeGeolocation !== undefined) plugin.setChangeGeolocation?.(o.changeGeolocation);
      if (o.changeTimezone !== undefined) plugin.setChangeTimezone?.(o.changeTimezone);
      if (o.changeWebRTC !== undefined) plugin.setChangeWebRTC?.(o.changeWebRTC);
      if (o.publicIPv4 !== undefined) plugin.setPublicIPv4?.(o.publicIPv4);
      if (o.publicIPv6 !== undefined) plugin.setPublicIPv6?.(o.publicIPv6);
      if (o.privateIPv4 !== undefined) plugin.setPrivateIPv4?.(o.privateIPv4);
      if (o.privateIPv6 !== undefined) plugin.setPrivateIPv6?.(o.privateIPv6);
      if (o.ipExtractionMethod !== undefined) plugin.setIPExtractionMethod?.(o.ipExtractionMethod as any);
      if (o.ipExtractionParam !== undefined) plugin.setIPExtractionParam?.(o.ipExtractionParam as any);
      if (o.ipExtractionURL !== undefined) plugin.setIPExtractionURL?.(o.ipExtractionURL as any);
      if (o.detectExternalIP !== undefined) plugin.setDetectExternalIP?.(o.detectExternalIP as any);
      if (o.ipInfoMethod !== undefined) plugin.setIPInfoMethod?.(o.ipInfoMethod);
      if (o.ipInfoKey !== undefined) plugin.setIPInfoKey?.(o.ipInfoKey);
      if (o.enableTunneling !== undefined) plugin.setEnableTunneling?.(o.enableTunneling);
      if (o.enableQUIC !== undefined) plugin.setEnableQUIC?.(o.enableQUIC);
      if (o.dnsMode !== undefined) plugin.setDNSMode?.(o.dnsMode);
      if (o.dnsIP !== undefined) plugin.setDNSIP?.(o.dnsIP);
    }

    if (!fs.existsSync(options.profileDir)) fs.mkdirSync(options.profileDir, { recursive: true });
    plugin.useProfile(options.profileDir, {
      loadFingerprint: false,
      loadProxy: false,
    });

    const browser = await plugin.launchPersistentContext(options.profileDir, {
      headless: options.headless ?? false,
      args: options.args,
      ignoreDefaultArgs: ['--enable-automation', '--allow-file-access-from-files'],
    });
    return browser;
  }
}
