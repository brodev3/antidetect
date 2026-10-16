import { buildApp, type BuildAppOptions } from "../../src/app.ts";
import { FingerprintGenerationError } from "../../src/application/fingerprints/fingerprint.generator.ts";

const unavailableFingerprintGenerator: BuildAppOptions["fingerprintGenerator"] = {
  async generate() {
    throw new FingerprintGenerationError("RUNTIME_NOT_INSTALLED");
  },
};

export function buildTestApp(
  options: Omit<BuildAppOptions, "fingerprintGenerator">,
): ReturnType<typeof buildApp> {
  return buildApp({
    ...options,
    fingerprintGenerator: unavailableFingerprintGenerator,
  });
}
