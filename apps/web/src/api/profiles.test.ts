import { afterEach, expect, test, vi } from "vitest";
import {
  createProfile,
  fetchProfiles,
  ProfileApiError,
  updateProfileFingerprintMode,
  updateProfileFingerprintPlatform,
} from "./profiles";

const profile = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  profileCode: "profile-001",
  displayName: "Research profile",
  fingerprintPlatform: "Windows",
  fingerprintEnabled: true,
  identityRef: "test-identity:550e8400-e29b-41d4-a716-446655440000",
  createdAt: "2026-09-21T10:00:00.000Z",
  updatedAt: "2026-09-21T10:00:00.000Z",
} as const;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

test("fetches and validates the profile list through the shared contract", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ items: [profile], nextOffset: null }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  );
  globalThis.fetch = fetchMock;

  await expect(fetchProfiles()).resolves.toEqual([profile]);
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/session",
    expect.objectContaining({ credentials: "include" }),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/profiles?limit=100",
    expect.objectContaining({
      credentials: "include",
      headers: { accept: "application/json" },
    }),
  );
});

test("rejects an HTTP failure or an invalid profile response", async () => {
  globalThis.fetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ ...profile, profileCode: "bad" }] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

  await expect(fetchProfiles()).rejects.toThrow("Unable to load profiles");
  await expect(fetchProfiles()).rejects.toThrow(
    "Profile API returned an invalid response",
  );
});

test("creates a profile through the shared contract", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(profile), {
        headers: { "content-type": "application/json" },
        status: 201,
      }),
    );
  globalThis.fetch = fetchMock;

  await expect(createProfile({ displayName: "  Research profile  " })).resolves.toEqual(
    profile,
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/profiles",
    expect.objectContaining({
      body: JSON.stringify({
        displayName: "Research profile",
        fingerprintEnabled: true,
        fingerprintPlatform: "Windows",
      }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
      credentials: "include",
    }),
  );
});

test("preserves the fingerprint runtime error code during profile creation", async () => {
  globalThis.fetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "FINGERPRINT_RUNTIME_NOT_READY",
            message: "Fingerprint runtime is not installed or is incomplete",
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 503,
        },
      ),
    );

  await expect(
    createProfile({ displayName: "Research profile" }),
  ).rejects.toMatchObject({
    code: "FINGERPRINT_RUNTIME_NOT_READY",
    statusCode: 503,
  } satisfies Partial<ProfileApiError>);
});

test("sends an explicitly selected target platform when creating a profile", async () => {
  const macProfile = { ...profile, fingerprintPlatform: "macOS" } as const;
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(macProfile), {
        headers: { "content-type": "application/json" },
        status: 201,
      }),
    );
  globalThis.fetch = fetchMock;

  await expect(
    createProfile({
      displayName: "Research profile",
      fingerprintPlatform: "macOS",
    }),
  ).resolves.toEqual(macProfile);
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/profiles",
    expect.objectContaining({
      body: JSON.stringify({
        displayName: "Research profile",
        fingerprintEnabled: true,
        fingerprintPlatform: "macOS",
      }),
      method: "POST",
    }),
  );
});

test("does not send an invalid create request and handles create failures", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 400 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...profile, profileCode: "invalid" }), {
        headers: { "content-type": "application/json" },
        status: 201,
      }),
    );
  globalThis.fetch = fetchMock;

  await expect(createProfile({ displayName: "   " })).rejects.toThrow(
    "Profile name is invalid",
  );
  expect(fetchMock).not.toHaveBeenCalled();

  await expect(createProfile({ displayName: "Research profile" })).rejects.toThrow(
    "Profile name is invalid",
  );
  await expect(createProfile({ displayName: "Research profile" })).rejects.toThrow(
    "Profile API returned an invalid response",
  );
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test("updates fingerprint mode through the shared profile contract", async () => {
  const disabledProfile = {
    ...profile,
    fingerprintEnabled: false,
    updatedAt: "2026-09-26T10:00:00.000Z",
  };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(disabledProfile), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
  globalThis.fetch = fetchMock;

  await expect(updateProfileFingerprintMode(profile.id, false)).resolves.toEqual(
    disabledProfile,
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/session",
    expect.objectContaining({ credentials: "include" }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    `/api/profiles/${profile.id}/fingerprint`,
    expect.objectContaining({
      body: JSON.stringify({ fingerprintEnabled: false }),
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "PATCH",
    }),
  );
});

test("exposes the busy-profile conflict from fingerprint update", async () => {
  globalThis.fetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "ACTIVE_BROWSER_RUN_CONFLICT",
            message: "Profile already has an active browser run",
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 409,
        },
      ),
    );

  await expect(updateProfileFingerprintMode(profile.id, false)).rejects.toMatchObject({
    code: "ACTIVE_BROWSER_RUN_CONFLICT",
    statusCode: 409,
  } satisfies Partial<ProfileApiError>);
});

test("updates an existing profile target platform through the shared contract", async () => {
  const macProfile = {
    ...profile,
    fingerprintPlatform: "macOS",
    identityRef: "test-identity:macos",
    updatedAt: "2026-10-17T10:00:00.000Z",
  };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(macProfile), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
  globalThis.fetch = fetchMock;

  await expect(updateProfileFingerprintPlatform(profile.id, "macOS")).resolves.toEqual(
    macProfile,
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/session",
    expect.objectContaining({ credentials: "include" }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    `/api/profiles/${profile.id}/fingerprint/platform`,
    expect.objectContaining({
      body: JSON.stringify({ fingerprintPlatform: "macOS" }),
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "PATCH",
    }),
  );
});

test("exposes the busy-profile conflict from platform update", async () => {
  globalThis.fetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "ACTIVE_BROWSER_RUN_CONFLICT",
            message: "Profile already has an active browser run",
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 409,
        },
      ),
    );

  await expect(
    updateProfileFingerprintPlatform(profile.id, "Linux"),
  ).rejects.toMatchObject({
    code: "ACTIVE_BROWSER_RUN_CONFLICT",
    statusCode: 409,
  } satisfies Partial<ProfileApiError>);
});
