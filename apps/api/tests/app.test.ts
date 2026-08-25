import { healthResponseSchema } from "@antidetect/contracts";
import { expect, test } from "vitest";
import { buildApp } from "../src/app.ts";

test("GET /health returns the API health status", async () => {
  const app = await buildApp();

  try {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: "ok",
    });
  } finally {
    await app.close();
  }
});

test("OpenAPI documents the health endpoint", async () => {
  const app = await buildApp();

  try {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/docs-json",
    });
    const document = response.json();

    expect(response.statusCode).toBe(200);
    expect(document.paths["/health"].get.responses["200"]).toBeDefined();
  } finally {
    await app.close();
  }
});
