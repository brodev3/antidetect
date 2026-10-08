import { afterEach, expect, test, vi } from "vitest";
import { fetchEngineStatus } from "./engine";

afterEach(() => vi.unstubAllGlobals());

test("reads engine status with session credentials and a shared abort signal", async () => {
  const value = { engine: "shardx", status: "not_installed", version: null };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json(value));
  vi.stubGlobal("fetch", fetchMock);
  const signal = new AbortController().signal;
  await expect(fetchEngineStatus(signal)).resolves.toEqual(value);
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/session",
    expect.objectContaining({ credentials: "include", signal }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/engine/status",
    expect.objectContaining({ credentials: "include", signal, cache: "no-store" }),
  );
});

test.each([
  new Response(null, { status: 503 }),
  Response.json({ engine: "shardx", status: "ready", version: "made-up" }),
  new Response("not-json", { status: 200 }),
])("failed and invalid status responses are rejected", async (response) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(response),
  );
  await expect(fetchEngineStatus(new AbortController().signal)).rejects.toThrow();
});

test("failed session setup does not request engine status", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchEngineStatus(new AbortController().signal)).rejects.toThrow(
    "Unable to establish API session",
  );
  expect(fetchMock).toHaveBeenCalledOnce();
});
