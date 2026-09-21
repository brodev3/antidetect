import {
  listProfilesResponseSchema,
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
