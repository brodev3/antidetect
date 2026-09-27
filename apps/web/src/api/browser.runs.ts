import {
  apiErrorSchema,
  browserRunStateResponseSchema,
  profilePathParamsSchema,
  type ApiErrorCode,
  type BrowserRunStateResponse,
} from "@antidetect/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

export class BrowserRunApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode | null,
  ) {
    super("Browser run request failed");
    this.name = "BrowserRunApiError";
  }
}

export interface BrowserRunCommandResult {
  readonly statusCode: 200 | 202;
  readonly state: BrowserRunStateResponse;
}

async function ensureApiSession(signal?: AbortSignal): Promise<void> {
  const requestInit: RequestInit = {
    credentials: "include",
    headers: { accept: "application/json" },
    method: "GET",
  };
  if (signal !== undefined) {
    requestInit.signal = signal;
  }

  const response = await fetch(`${API_BASE_URL}/session`, requestInit);
  if (!response.ok) {
    throw new Error("Unable to establish API session");
  }
}

function getProfilePath(profileId: string): string {
  const parsed = profilePathParamsSchema.safeParse({ profileId });
  if (!parsed.success) {
    throw new Error("Profile id is invalid");
  }

  return `${API_BASE_URL}/profiles/${encodeURIComponent(parsed.data.profileId)}`;
}

function getProfileRunPath(profileId: string): string {
  return `${getProfilePath(profileId)}/run`;
}

async function parseRunStateResponse(
  response: Response,
): Promise<BrowserRunStateResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Browser run API returned an invalid response");
  }

  const parsed = browserRunStateResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Browser run API returned an invalid response");
  }

  return parsed.data;
}

async function throwApiError(response: Response): Promise<never> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new BrowserRunApiError(response.status, null);
  }

  const parsed = apiErrorSchema.safeParse(body);
  throw new BrowserRunApiError(
    response.status,
    parsed.success ? parsed.data.error.code : null,
  );
}

export async function fetchBrowserRunState(
  profileId: string,
  signal?: AbortSignal,
): Promise<BrowserRunStateResponse> {
  const runPath = getProfileRunPath(profileId);
  await ensureApiSession(signal);

  const requestInit: RequestInit = {
    credentials: "include",
    headers: { accept: "application/json" },
    method: "GET",
  };
  if (signal !== undefined) {
    requestInit.signal = signal;
  }

  const response = await fetch(runPath, requestInit);
  if (!response.ok) {
    await throwApiError(response);
  }

  return parseRunStateResponse(response);
}

async function sendRunCommand(
  profileId: string,
  command: "start" | "stop",
  signal?: AbortSignal,
): Promise<BrowserRunCommandResult> {
  const profilePath = getProfilePath(profileId);
  await ensureApiSession(signal);

  const requestInit: RequestInit = {
    credentials: "include",
    headers: { accept: "application/json" },
    method: "POST",
  };
  if (signal !== undefined) {
    requestInit.signal = signal;
  }

  const response = await fetch(`${profilePath}/${command}`, requestInit);
  const acceptedStatuses: readonly number[] = command === "start" ? [202] : [200, 202];
  if (!acceptedStatuses.includes(response.status)) {
    if (!response.ok) {
      await throwApiError(response);
    }

    throw new Error("Browser run API returned an invalid response");
  }

  return {
    statusCode: response.status as 200 | 202,
    state: await parseRunStateResponse(response),
  };
}

export function startBrowserRun(
  profileId: string,
  signal?: AbortSignal,
): Promise<BrowserRunCommandResult> {
  return sendRunCommand(profileId, "start", signal);
}

export function stopBrowserRun(
  profileId: string,
  signal?: AbortSignal,
): Promise<BrowserRunCommandResult> {
  return sendRunCommand(profileId, "stop", signal);
}
