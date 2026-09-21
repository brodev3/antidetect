import { afterEach, expect, test, vi } from "vitest";
import { createProfile, fetchProfiles } from "./profiles";

const profile = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  profileCode: "profile-001",
  displayName: "Research profile",
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
      body: JSON.stringify({ displayName: "Research profile" }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
      credentials: "include",
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
