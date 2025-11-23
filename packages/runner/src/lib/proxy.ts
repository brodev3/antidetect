import axios, { type AxiosInstance } from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ProxyType, ProxyCheckOptions, ProxyCheckResult } from '../types/proxy';

interface InternalCheckOptions extends ProxyCheckOptions {
  endpoints?: NonNullable<ProxyCheckOptions['endpoints']>;
}

function buildAxiosForProxy(
  type: ProxyType,
  host: string,
  port: number,
  username?: string,
  password?: string,
): AxiosInstance {
  if (type === 'https') {
    const proxy = username && password
      ? { protocol: 'http', host, port, auth: { username, password } }
      : { protocol: 'http', host, port };
    return axios.create({ proxy });
  }

  const auth = `${username ?? ''}:${password ?? ''}@`;
  const agent = new SocksProxyAgent(`socks5://${auth}${host}:${port}`);
  return axios.create({ httpsAgent: agent, httpAgent: agent, proxy: false });
}

export async function checkProxyGeo(
  type: ProxyType,
  host: string,
  port: number,
  username?: string,
  password?: string,
  opts?: InternalCheckOptions,
): Promise<ProxyCheckResult> {
  try {
    const client = buildAxiosForProxy(type, host, port, username, password);
    const start = Date.now();
    const resp = await client.get(opts?.endpoints?.geoUrl ?? 'http://ip-api.com/json', {
      timeout: opts?.timeoutMs ?? 8000,
    });
    const latencyMs = Date.now() - start;
    const data = resp.data as Record<string, any> | undefined;
    const dataValid = typeof data === 'object' && data !== null && data.status === 'success';
    const ok = resp.status === 200 && dataValid;
    const geoOk = opts?.expectedCountryCode ? data?.countryCode === opts.expectedCountryCode : true;
    return {
      ok: ok && geoOk,
      ip: data?.query,
      country: data?.country,
      countryCode: data?.countryCode,
      regionName: data?.regionName,
      city: data?.city,
      org: data?.org,
      as: data?.as,
      lat: data?.lat,
      lon: data?.lon,
      latencyMs,
      errorCode: ok ? (geoOk ? undefined : 'country_mismatch') : 'probe_failed',
      reason: ok ? (geoOk ? undefined : 'country_mismatch') : 'probe_failed',
    };
  } catch (error: any) {
    return {
      ok: false,
      errorCode: error?.code === 'ECONNABORTED' ? 'timeout' : 'exception',
      reason: error?.message,
    };
  }
}

export async function checkProxyEcho(
  type: ProxyType,
  host: string,
  port: number,
  username?: string,
  password?: string,
  opts?: InternalCheckOptions,
): Promise<ProxyCheckResult> {
  try {
    const client = buildAxiosForProxy(type, host, port, username, password);
    const start = Date.now();
    const resp = await client.get(opts?.endpoints?.echoUrl ?? 'http://ip.bablosoft.com/', {
      timeout: opts?.timeoutMs ?? 8000,
    });
    const latencyMs = Date.now() - start;
    const ok = !!resp.status;
    const ip = typeof resp.data === 'string' ? String(resp.data).trim() : undefined;
    return { ok, ip, latencyMs };
  } catch (error: any) {
    return {
      ok: false,
      errorCode: error?.code === 'ECONNABORTED' ? 'timeout' : 'exception',
      reason: error?.message,
    };
  }
}

/** Helper class that caches default endpoints and timeout configuration for proxy probes. */
export class ProxyChecker {
  constructor(private readonly defaults: ProxyCheckOptions = {}) {}

  private merge(opts?: ProxyCheckOptions): InternalCheckOptions {
    return {
      ...this.defaults,
      ...opts,
      endpoints: {
        ...(this.defaults.endpoints ?? {}),
        ...(opts?.endpoints ?? {}),
      },
    };
  }

  async echo(
    type: ProxyType,
    host: string,
    port: number,
    username?: string,
    password?: string,
    opts?: ProxyCheckOptions,
  ): Promise<ProxyCheckResult> {
    return checkProxyEcho(type, host, port, username, password, this.merge(opts));
  }

  async geo(
    type: ProxyType,
    host: string,
    port: number,
    username?: string,
    password?: string,
    opts?: ProxyCheckOptions,
  ): Promise<ProxyCheckResult> {
    return checkProxyGeo(type, host, port, username, password, this.merge(opts));
  }
}
