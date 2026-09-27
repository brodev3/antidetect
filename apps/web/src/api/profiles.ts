import {
  apiErrorSchema,
  createProfileRequestSchema,
  listProfilesResponseSchema,
  profilePathParamsSchema,
  profileResponseSchema,
  updateProfileFingerprintModeRequestSchema,
  type ApiErrorCode,
  type CreateProfileRequest,
  type ProfileResponse,
} from "@antidetect/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

export class ProfileApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode | null,
  ) {
    super("Profile request failed");
    this.name = "ProfileApiError";
  }
}

function getProfilePath(profileId: string): string {
  const parsed = profilePathParamsSchema.safeParse({ profileId });
  if (!parsed.success) {
    throw new Error("Profile id is invalid");
  }

  return `${API_BASE_URL}/profiles/${encodeURIComponent(parsed.data.profileId)}`;
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

async function throwProfileApiError(response: Response): Promise<never> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ProfileApiError(response.status, null);
  }

  const parsed = apiErrorSchema.safeParse(body);
  throw new ProfileApiError(
    response.status,
    parsed.success ? parsed.data.error.code : null,
  );
}

export async function fetchProfiles(
  signal?: AbortSignal,
): Promise<readonly ProfileResponse[]> {
  await ensureApiSession(signal);
  const requestInit: RequestInit = {
    credentials: "include",
    headers: { accept: "application/json" },
  };
  if (signal !== undefined) {
    requestInit.signal = signal;
  }

  const response = await fetch(`${API_BASE_URL}/profiles?limit=100`, requestInit);

  if (!response.ok) {
    throw new Error("Unable to load profiles");
  }

  const parsed = listProfilesResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Profile API returned an invalid response");
  }

  return parsed.data.items;
}

export async function createProfile(
  request: CreateProfileRequest,
  signal?: AbortSignal,
): Promise<ProfileResponse> {
  const parsedRequest = createProfileRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new Error("Profile name is invalid");
  }

  await ensureApiSession(signal);
  const requestInit: RequestInit = {
    body: JSON.stringify(parsedRequest.data),
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
  };
  if (signal !== undefined) {
    requestInit.signal = signal;
  }

  const response = await fetch(`${API_BASE_URL}/profiles`, requestInit);

  if (!response.ok) {
    throw new Error(
      response.status === 400 ? "Profile name is invalid" : "Unable to create profile",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Profile API returned an invalid response");
  }

  const parsedResponse = profileResponseSchema.safeParse(body);
  if (!parsedResponse.success) {
    throw new Error("Profile API returned an invalid response");
  }

  return parsedResponse.data;
}

export async function updateProfileFingerprintMode(
  profileId: string,
  fingerprintEnabled: boolean,
  signal?: AbortSignal,
): Promise<ProfileResponse> {
  const profilePath = getProfilePath(profileId);
  const parsedRequest = updateProfileFingerprintModeRequestSchema.safeParse({
    fingerprintEnabled,
  });
  if (!parsedRequest.success) {
    throw new Error("Fingerprint setting is invalid");
  }

  await ensureApiSession(signal);
  const requestInit: RequestInit = {
    body: JSON.stringify(parsedRequest.data),
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "PATCH",
  };
  if (signal !== undefined) {
    requestInit.signal = signal;
  }

  const response = await fetch(`${profilePath}/fingerprint`, requestInit);
  if (!response.ok) {
    await throwProfileApiError(response);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Profile API returned an invalid response");
  }

  const parsedResponse = profileResponseSchema.safeParse(body);
  if (!parsedResponse.success) {
    throw new Error("Profile API returned an invalid response");
  }

  return parsedResponse.data;
}
