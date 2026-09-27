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

test("allows only explicitly configured UI origins", async () => {
  const app = await buildApp({
    profileRepository: createProfileRepositoryStub(),
    config: {
      host: "127.0.0.1",
      port: 3000,
      allowedOrigins: ["http://127.0.0.1:5173"],
    },
  });

  try {
    const allowedResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/health",
        headers: {
          host: validHost,
          origin: "http://127.0.0.1:5173",
        },
      });
    const unlistedResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/health",
        headers: {
          host: validHost,
          origin: "http://127.0.0.1:3000",
        },
      });
    const sessionResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/session",
        headers: { host: validHost },
      });
    const sessionCookie = String(sessionResponse.headers["set-cookie"] ?? "").split(
      ";",
      1,
    )[0];
    const createResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/profiles",
        headers: {
          host: validHost,
          origin: "http://127.0.0.1:5173",
          cookie: sessionCookie,
          "content-type": "application/json",
        },
        payload: { displayName: "Vite profile" },
      });

    expect(allowedResponse.statusCode).toBe(200);
    expect(unlistedResponse.statusCode).toBe(403);
    expect(sessionResponse.statusCode).toBe(204);
    expect(createResponse.statusCode).toBe(201);
  } finally {
    await app.close();
  }
});

test("requires an allowed Origin for state-changing requests", async () => {
  const app = await buildApp({
    profileRepository: createProfileRepositoryStub(),
  });

  try {
    const missingOriginResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/profiles",
        headers: { host: validHost },
      });
    const unapprovedOriginResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/profiles",
        headers: {
          host: validHost,
          origin: "http://attacker.example",
        },
      });

    expect(missingOriginResponse.statusCode).toBe(403);
    expect(unapprovedOriginResponse.statusCode).toBe(403);
  } finally {
    await app.close();
  }
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

test("requires and issues a local session for non-public routes", async () => {
  const app = await buildApp({
    profileRepository: createProfileRepositoryStub(),
  });

  try {
    const unauthorizedResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/profiles",
        headers: { host: validHost },
      });

    expect(unauthorizedResponse.statusCode).toBe(401);
    expect(unauthorizedResponse.json()).toEqual({
      message: "Unauthorized",
      statusCode: 401,
    });

    const sessionResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/session",
        headers: { host: validHost },
      });
    const setCookie = String(sessionResponse.headers["set-cookie"] ?? "");
    const sessionCookie = setCookie.split(";", 1)[0];

    expect(sessionResponse.statusCode).toBe(204);
    expect(setCookie).toMatch(
      /^antidetect_session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict$/,
    );

    const repeatedSessionResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/session",
        headers: { host: validHost, cookie: sessionCookie },
      });

    expect(repeatedSessionResponse.statusCode).toBe(204);
    expect(repeatedSessionResponse.headers["set-cookie"]).toBeUndefined();

    const authorizedResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/profiles",
        headers: { host: validHost, cookie: sessionCookie },
      });

    expect(authorizedResponse.statusCode).toBe(200);

    const invalidResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/profiles",
        headers: { host: validHost, cookie: "antidetect_session=invalid" },
      });

    expect(invalidResponse.statusCode).toBe(401);
  } finally {
    await app.close();
  }
});
