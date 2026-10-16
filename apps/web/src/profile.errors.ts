import { ProfileApiError } from "./api/profiles";

export function getCreateProfileErrorMessage(error: unknown): string {
  if (error instanceof ProfileApiError) {
    if (error.code === "FINGERPRINT_RUNTIME_NOT_READY") {
      return "Local fingerprint generation is unavailable. Turn it off for this profile or check the local runtime.";
    }

    return "Unable to create profile";
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Unable to create profile";
}
