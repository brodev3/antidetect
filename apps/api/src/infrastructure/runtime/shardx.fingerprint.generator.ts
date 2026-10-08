import { Buffer } from "node:buffer";
import {
  Profile,
  randomizeHardware,
  randomizePlatformVersion,
} from "@proxyshard/shardx";
import { z } from "zod";
import {
  FingerprintGenerationError,
  type FingerprintGenerator,
} from "../../application/fingerprints/fingerprint.generator.js";
import { InvalidFingerprintIdentityError } from "../../application/fingerprints/fingerprint.identity.errors.js";
import { MAX_FINGERPRINT_CONFIG_BYTES } from "../../application/fingerprints/fingerprint.identity.repository.js";
import type { AppPaths } from "../../config/app.paths.js";
import { createShardXSdk } from "./shardx.sdk.js";

export interface ShardXFingerprintSource {
  randomProfile(options: {
    readonly platform: string;
  }): Promise<{ readonly config: Readonly<Record<string, unknown>> }>;
}

export interface ShardXFingerprintRandomizers {
  readonly hardware: typeof randomizeHardware;
  readonly platformVersion: typeof randomizePlatformVersion;
}

const defaultRandomizers: ShardXFingerprintRandomizers = {
  hardware: randomizeHardware,
  platformVersion: randomizePlatformVersion,
};
const uuidSchema = z.uuid();
const windowsConfigSchema = z.record(z.string(), z.json()).refine((config) => {
  const navigator = config.navigator;
  return (
    navigator !== null &&
    typeof navigator === "object" &&
    !Array.isArray(navigator) &&
    navigator.platform === "Windows"
  );
});

function copyConfig(config: unknown): Record<string, unknown> {
  const parsed = windowsConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new FingerprintGenerationError("FINGERPRINT_GENERATION_FAILED");
  }
  if (
    Buffer.byteLength(JSON.stringify(parsed.data), "utf8") >
    MAX_FINGERPRINT_CONFIG_BYTES
  ) {
    throw new FingerprintGenerationError("FINGERPRINT_GENERATION_FAILED");
  }
  return parsed.data;
}

function isRuntimeNotInstalled(error: unknown): boolean {
  try {
    return (
      error !== null &&
      typeof error === "object" &&
      Object.getOwnPropertyDescriptor(error, "code")?.value === "RUNTIME_NOT_INSTALLED"
    );
  } catch {
    return false;
  }
}

/** Generates config only: never saves a profile, installs or launches a browser. */
export class ShardXFingerprintGenerator implements FingerprintGenerator {
  constructor(
    paths: Pick<AppPaths, "runtimeDir" | "profilesDir">,
    private readonly source: ShardXFingerprintSource = createShardXSdk(paths),
    private readonly randomizers: ShardXFingerprintRandomizers = defaultRandomizers,
  ) {}

  async generate(identityId: string): Promise<Readonly<Record<string, unknown>>> {
    if (!uuidSchema.safeParse(identityId).success) {
      throw new InvalidFingerprintIdentityError();
    }

    try {
      // autoInstall:false in the default factory makes this a local-only read.
      const template = await this.source.randomProfile({ platform: "Windows" });
      const profile = new Profile(copyConfig(template.config), identityId);
      this.randomizers.hardware(profile.config, identityId);
      this.randomizers.platformVersion(profile.config);
      // Validate again and detach the result from the SDK's mutable working copy.
      return copyConfig(profile.config);
    } catch (error) {
      throw new FingerprintGenerationError(
        isRuntimeNotInstalled(error)
          ? "RUNTIME_NOT_INSTALLED"
          : "FINGERPRINT_GENERATION_FAILED",
      );
    }
  }
}
