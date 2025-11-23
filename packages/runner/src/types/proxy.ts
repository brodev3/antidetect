export type ProxyType = 'https' | 'socks5';

export type ProxyCheckResult = {
  ok: boolean;
  ip?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  org?: string;
  as?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  latencyMs?: number;
  errorCode?: 'timeout' | 'probe_failed' | 'country_mismatch' | 'exception';
  reason?: string;
};

export type ProxyEndpoints = {
  echoUrl?: string;
  geoUrl?: string;
};

export type ProxyCheckOptions = {
  expectedCountryCode?: string;
  timeoutMs?: number;
  endpoints?: ProxyEndpoints;
};

export type PublicIPReplacement = 'auto' | string;
export type PrivateIPReplacement = 'local' | string;
export type IPExtractionMethod = 'raw' | 'regexp' | 'jsonpath' | string;

export interface ProxyPluginOptions {
  changeBrowserLanguage?: boolean;
  changeGeolocation?: boolean;
  changeTimezone?: boolean;
  changeWebRTC?: 'enable' | 'disable' | 'replace';
  publicIPv4?: PublicIPReplacement | { v4: PublicIPReplacement };
  publicIPv6?: PublicIPReplacement | { v6: PublicIPReplacement };
  privateIPv4?: PrivateIPReplacement | 'private class a' | 'private class b' | 'private class c';
  privateIPv6?: PrivateIPReplacement | 'unique local address';
  ipExtractionMethod?: IPExtractionMethod | { v4: IPExtractionMethod; v6: IPExtractionMethod };
  ipExtractionParam?: string | { v4: string; v6: string };
  ipExtractionURL?: string | { v4: string; v6: string };
  detectExternalIP?: boolean | { v4: boolean; v6: boolean };
  ipInfoMethod?: 'database' | 'ip-api.com';
  ipInfoKey?: string;
  enableTunneling?: boolean;
  enableQUIC?: boolean;
  dnsMode?: 'system-proxy' | 'custom-proxy' | 'custom-direct';
  dnsIP?: string;
}



