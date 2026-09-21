import {
  createProfileRequestSchema,
  listProfilesResponseSchema,
  profileResponseSchema,
  type CreateProfileRequest,
  type ProfileResponse,
} from "@antidetect/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

export async function fetchProfiles(
  signal?: AbortSignal,
): Promise<readonly ProfileResponse[]> {
  const requestInit: RequestInit = {
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

  const requestInit: RequestInit = {
    body: JSON.stringify(parsedRequest.data),
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
