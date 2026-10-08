export interface FingerprintGenerator {
  // The caller owns identity metadata and persistence, not the SDK.
  generate(identityId: string): Promise<Readonly<Record<string, unknown>>>;
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
