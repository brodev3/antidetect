import { expect, test } from "vitest";
import { buildApp } from "../src/app.ts";
import { createProfileRepositoryStub } from "./support/profile.repository.stub.ts";

const validHost = "127.0.0.1:3000";

async function request(
  headers: Record<string, string> = { host: validHost },
): Promise<{ statusCode: number; json: () => unknown }> {
  const app = await buildApp({
    profileRepository: createProfileRepositoryStub(),
  });

  try {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/health",
      headers,
    });

    return {
      statusCode: response.statusCode,
      json: () => response.json(),
    };
  } finally {
    await app.close();
  }
}

test("allows a loopback request without Origin", async () => {
  const response = await request();

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "ok" });
});

test("allows the exact local same-origin request", async () => {
  const response = await request({
    host: validHost,
    origin: "http://127.0.0.1:3000",
  });

  expect(response.statusCode).toBe(200);
});

test.each([
  { host: "localhost:3000" },
  { host: "192.168.1.20:3000" },
  { host: validHost, origin: "http://localhost:3000" },
  { host: validHost, origin: "https://127.0.0.1:3000" },
  { host: validHost, origin: "null" },
])("rejects an unapproved Host or Origin: $host / $origin", async (headers) => {
  const response = await request(headers);

  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({
    message: "Forbidden",
    statusCode: 403,
  });
});
