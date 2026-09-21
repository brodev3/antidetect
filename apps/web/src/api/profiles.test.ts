import { afterEach, expect, test, vi } from "vitest";
import { fetchProfiles } from "./profiles";

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
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/profiles?limit=100",
    expect.objectContaining({ headers: { accept: "application/json" } }),
  );
});

test("rejects an HTTP failure or an invalid profile response", async () => {
  globalThis.fetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
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
