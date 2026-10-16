import { describe, expect, test } from "vitest";
import { apiErrorSchema } from "../src/errors.ts";

describe("apiErrorSchema", () => {
  test.each([
    "VALIDATION_ERROR",
    "PROFILE_NOT_FOUND",
    "FINGERPRINT_RUNTIME_NOT_READY",
    "FINGERPRINT_GENERATION_FAILED",
  ] as const)("accepts the %s code", (code) => {
    expect(
      apiErrorSchema.parse({
        error: { code, message: "Safe public message" },
      }),
    ).toEqual({ error: { code, message: "Safe public message" } });
  });

  test.each([
    { error: { code: "INTERNAL_ERROR", message: "Unsupported code" } },
    { error: { code: "VALIDATION_ERROR", message: "" } },
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Safe public message",
        details: "not part of the public contract",
      },
    },
  ])("rejects an invalid error envelope", (value) => {
    expect(apiErrorSchema.safeParse(value).success).toBe(false);
  });
});
