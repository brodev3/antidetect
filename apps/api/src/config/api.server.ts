export const DEFAULT_API_HOST = "127.0.0.1" as const;
export const DEFAULT_API_PORT = 3000;

export type ApiHost = "127.0.0.1" | "::1";

export interface ApiServerConfig {
  readonly host: ApiHost;
  readonly port: number;
  readonly allowedOrigins?: readonly string[];
}

export const DEFAULT_API_SERVER_CONFIG: ApiServerConfig = {
  host: DEFAULT_API_HOST,
  port: DEFAULT_API_PORT,
};

export function parseApiHost(value: string | undefined): ApiHost {
  const host = value ?? DEFAULT_API_HOST;

  if (host === "127.0.0.1" || host === "::1") {
    return host;
  }

  throw new Error("API_HOST must be exactly 127.0.0.1 or ::1");
}

export function parseApiPort(value: string | undefined): number {
  const rawPort = value ?? String(DEFAULT_API_PORT);

  if (!/^\d+$/.test(rawPort)) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  return port;
}

export function readApiServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiServerConfig {
  return {
    host: parseApiHost(environment.API_HOST),
    port: parseApiPort(environment.API_PORT),
  };
}

export function formatApiHostForUrl(host: ApiHost): string {
  return host === "::1" ? `[${host}]` : host;
}
