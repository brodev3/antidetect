import { expect, test } from "vitest";
import { ProfileApiError } from "./api/profiles";
import { getCreateProfileErrorMessage } from "./profile.errors";

test("explains when local fingerprint generation is unavailable", () => {
  expect(
    getCreateProfileErrorMessage(
      new ProfileApiError(503, "FINGERPRINT_RUNTIME_NOT_READY"),
    ),
  ).toBe(
    "Local fingerprint generation is unavailable. Turn it off for this profile or check the local runtime.",
  );
});

test("uses a generic message for other profile API errors", () => {
  expect(
    getCreateProfileErrorMessage(
      new ProfileApiError(500, "FINGERPRINT_GENERATION_FAILED"),
    ),
  ).toBe("Unable to create profile");
});
