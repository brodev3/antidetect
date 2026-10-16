import type { FingerprintPlatform } from "@antidetect/contracts";

export {
  DEFAULT_FINGERPRINT_PLATFORM,
  FINGERPRINT_PLATFORMS,
} from "@antidetect/contracts";
export type { FingerprintPlatform } from "@antidetect/contracts";

export interface FingerprintGenerator {
  // The caller owns identity metadata and persistence, not the SDK.
  generate(
    identityId: string,
    platform?: FingerprintPlatform,
  ): Promise<Readonly<Record<string, unknown>>>;
}

export type FingerprintGenerationErrorCode =
  "RUNTIME_NOT_INSTALLED" | "FINGERPRINT_GENERATION_FAILED";

export class FingerprintGenerationError extends Error {
  constructor(readonly code: FingerprintGenerationErrorCode) {
    super(
      code === "RUNTIME_NOT_INSTALLED"
        ? "Local fingerprint runtime is not installed or is incomplete"
        : "Fingerprint generation failed",
    );
    this.name = "FingerprintGenerationError";
  }
}
