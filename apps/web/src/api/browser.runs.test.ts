import { afterEach, expect, test, vi } from "vitest";
import {
  BrowserRunApiError,
  fetchBrowserRunState,
  startBrowserRun,
  stopBrowserRun,
} from "./browser.runs";

const profileId = "550e8400-e29b-41d4-a716-446655440000";
const runState = {
  run: {
    id: "550e8400-e29b-41d4-a716-446655440001",
    profileId,
    status: "starting",
    createdAt: "2026-09-26T10:00:00.000Z",
    updatedAt: "2026-09-26T10:00:00.000Z",
    endedAt: null,
  },
} as const;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

test("fetches and validates the latest run through the shared contract", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(jsonResponse(runState, 200));
  globalThis.fetch = fetchMock;

  await expect(fetchBrowserRunState(profileId)).resolves.toEqual(runState);
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/session",
    expect.objectContaining({ credentials: "include", method: "GET" }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    `/api/profiles/${profileId}/run`,
    expect.objectContaining({ credentials: "include", method: "GET" }),
  );
});

test("starts a run and accepts only the asynchronous 202 response", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(jsonResponse(runState, 202));
  globalThis.fetch = fetchMock;

  await expect(startBrowserRun(profileId)).resolves.toEqual({
    statusCode: 202,
    state: runState,
  });
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    `/api/profiles/${profileId}/start`,
    expect.objectContaining({ credentials: "include", method: "POST" }),
  );
});

test.each([
  {
    status: 200,
    run: { ...runState.run, status: "stopped", endedAt: "2026-09-26T10:01:00.000Z" },
  },
  { status: 202, run: { ...runState.run, status: "stopping" } },
])("stops a run with HTTP $status", async ({ status, run }) => {
  const state = { run };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(jsonResponse(state, status));
  globalThis.fetch = fetchMock;

  await expect(stopBrowserRun(profileId)).resolves.toEqual({
    statusCode: status,
    state,
  });
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    `/api/profiles/${profileId}/stop`,
    expect.objectContaining({ credentials: "include", method: "POST" }),
  );
});

test("preserves a validated conflict code so the UI can refresh the run state", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "BROWSER_RUN_START_IN_PROGRESS",
            message: "Request validation failed",
          },
        },
        409,
      ),
    );
  globalThis.fetch = fetchMock;

  await expect(stopBrowserRun(profileId)).rejects.toMatchObject({
    statusCode: 409,
    code: "BROWSER_RUN_START_IN_PROGRESS",
  } satisfies Partial<BrowserRunApiError>);
});

test("rejects invalid profile ids without making a request", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  globalThis.fetch = fetchMock;

  await expect(fetchBrowserRunState("not-a-uuid")).rejects.toThrow(
    "Profile id is invalid",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("rejects invalid HTTP and response bodies", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      jsonResponse({ run: { ...runState.run, status: "mystery" } }, 200),
    );
  globalThis.fetch = fetchMock;

  await expect(fetchBrowserRunState(profileId)).rejects.toMatchObject({
    statusCode: 503,
    code: null,
  });
  await expect(fetchBrowserRunState(profileId)).rejects.toThrow(
    "Browser run API returned an invalid response",
  );
});
