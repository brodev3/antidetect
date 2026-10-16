import { engineStatusResponseSchema } from "@antidetect/contracts";
import { expect, test, vi } from "vitest";
import { buildTestApp } from "./support/build.test.app.ts";
import { createProfileRepositoryStub } from "./support/profile.repository.stub.ts";

const headers = { host: "127.0.0.1:3000" };

test("engine status is session-protected, fresh, sanitized and documented", async () => {
  const read = vi.fn().mockResolvedValue({
    engine: "shardx",
    status: "files_detected",
    version: "152.0.7977.65",
    runtimeDirectory: "C:/private/runtime",
    endpoint: "private-endpoint",
  });
  const app = await buildTestApp({
    profileRepository: createProfileRepositoryStub(),
    engineStatusReader: { read },
  });
  try {
    const http = app.getHttpAdapter().getInstance();
    const unauthorized = await http.inject({
      method: "GET",
      url: "/engine/status",
      headers,
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(read).not.toHaveBeenCalled();

    const session = await http.inject({ method: "GET", url: "/session", headers });
    const cookie = String(session.headers["set-cookie"]).split(";", 1)[0]!;
    const response = await http.inject({
      method: "GET",
      url: "/engine/status",
      headers: { ...headers, cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      engine: "shardx",
      status: "files_detected",
      version: "152.0.7977.65",
    });
    expect(engineStatusResponseSchema.safeParse(response.json()).success).toBe(true);
    expect(read).toHaveBeenCalledOnce();

    read.mockResolvedValueOnce({
      engine: "shardx",
      status: "not_installed",
      version: null,
    });
    const updated = await http.inject({
      method: "GET",
      url: "/engine/status",
      headers: { ...headers, cookie },
    });
    expect(updated.json().status).toBe("not_installed");
    const forbidden = await http.inject({
      method: "GET",
      url: "/engine/status",
      headers: { ...headers, cookie, origin: "https://untrusted.invalid" },
    });
    expect(forbidden.statusCode).toBe(403);

    const docs = await http.inject({ method: "GET", url: "/docs-json", headers });
    expect(docs.json().paths["/engine/status"].get.responses["200"]).toBeDefined();
  } finally {
    await app.close();
  }
});

test("composition without an engine reader reports unavailable, not fake installation", async () => {
  const app = await buildTestApp({ profileRepository: createProfileRepositoryStub() });
  try {
    const http = app.getHttpAdapter().getInstance();
    const session = await http.inject({ method: "GET", url: "/session", headers });
    const cookie = String(session.headers["set-cookie"]).split(";", 1)[0]!;
    const response = await http.inject({
      method: "GET",
      url: "/engine/status",
      headers: { ...headers, cookie },
    });
    expect(response.json()).toEqual({
      engine: "shardx",
      status: "unavailable",
      version: null,
    });
  } finally {
    await app.close();
  }
});
