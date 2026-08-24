import { describe, expect, test } from "vitest";
import { healthResponseSchema } from "../src/health.ts";

describe("healthResponseSchema", () => {
  test("accepts a valid health response", () => {
    expect(healthResponseSchema.safeParse({ status: "ok" }).success).toBe(true);
  });

  test("rejects an unsupported status", () => {
    expect(healthResponseSchema.safeParse({ status: "error" }).success).toBe(false);
  });
});
