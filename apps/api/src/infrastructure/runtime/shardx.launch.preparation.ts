import { isAbsolute, join, resolve } from "node:path";
import { Profile, type ShardX, type ShardXLaunchOptions } from "@proxyshard/shardx";
import { z } from "zod";
import {
  FINGERPRINT_FORMAT_VERSION,
  type FingerprintIdentityRepository,
} from "../../application/fingerprints/fingerprint.identity.repository.js";
import type {
  RuntimeLaunchFailedBeforeSpawn,
  RuntimeLaunchInput,
} from "../../application/runtime/browser.runtime.js";
import type { AppPaths } from "../../config/app.paths.js";
import { createShardXSdk } from "./shardx.sdk.js";

const uuidSchema = z.uuid();
const fingerprintConfigSchema = z
  .record(z.string(), z.json())
  .refine((config) => Object.keys(config).length > 0);

export interface ShardXLaunchFingerprint {
  readonly identityRef: string;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface PreparedShardXLaunch {
  readonly status: "prepared";
  readonly profile: Profile;
  readonly options: Readonly<ShardXLaunchOptions>;
}

export type ShardXLaunchPreparationResult =
  PreparedShardXLaunch | RuntimeLaunchFailedBeforeSpawn;

function failed(failureCode: string): RuntimeLaunchFailedBeforeSpawn {
  return { status: "failed_before_spawn", failureCode };
}

/** Infrastructure-only preparation. It never calls launch, session, or install. */
export class ShardXLaunchPreparer {
  private readonly profilesDirectory: string;

  constructor(
    paths: Pick<AppPaths, "runtimeDir" | "profilesDir">,
    private readonly sdk: Pick<ShardX, "listProfiles"> = createShardXSdk(paths),
  ) {
    this.profilesDirectory = paths.profilesDir;
  }

  async prepare(
    input: RuntimeLaunchInput,
    fingerprint: ShardXLaunchFingerprint | null,
  ): Promise<ShardXLaunchPreparationResult> {
    const inputFailure = this.validateInput(input);
    if (inputFailure !== null) return inputFailure;
    const profileDirectory = resolve(join(this.profilesDirectory, input.profileId));
    if (fingerprint === null || fingerprint.identityRef !== input.identityRef) {
      return failed("RUNTIME_FINGERPRINT_UNAVAILABLE");
    }

    let profile: Profile;
    try {
      const config = fingerprintConfigSchema.safeParse(fingerprint.config);
      if (!config.success) return failed("RUNTIME_FINGERPRINT_UNAVAILABLE");
      // Snapshot before awaiting readiness; SDK mutations must not change stored identity.
      profile = new Profile(config.data, input.profileId);
    } catch {
      return failed("RUNTIME_FINGERPRINT_UNAVAILABLE");
    }

    try {
      // The default factory fixes autoInstall:false. This checks local SDK readiness only.
      await this.sdk.listProfiles();
    } catch (error) {
      const code: unknown =
        error !== null && typeof error === "object"
          ? Object.getOwnPropertyDescriptor(error, "code")?.value
          : undefined;
      return failed(
        code === "RUNTIME_NOT_INSTALLED"
          ? "RUNTIME_NOT_INSTALLED"
          : "RUNTIME_PREPARATION_FAILED",
      );
    }

    return {
      status: "prepared",
      profile,
      options: {
        userDataDir: profileDirectory,
        randomize: false,
        headless: false,
        cdp: true,
      },
    };
  }

  async prepareStored(
    input: RuntimeLaunchInput,
    identities: Pick<FingerprintIdentityRepository, "findById">,
  ): Promise<ShardXLaunchPreparationResult> {
    const snapshot: RuntimeLaunchInput = {
      runId: input.runId,
      profileId: input.profileId,
      profileDirectory: input.profileDirectory,
      identityRef: input.identityRef,
    };
    const inputFailure = this.validateInput(snapshot);
    if (inputFailure !== null) return inputFailure;
    const identityRef = uuidSchema.safeParse(snapshot.identityRef);
    if (!identityRef.success) return failed("RUNTIME_FINGERPRINT_UNAVAILABLE");

    let fingerprint: ShardXLaunchFingerprint;
    try {
      const identity = await identities.findById(identityRef.data);
      if (
        identity === null ||
        identity.id !== identityRef.data ||
        identity.formatVersion !== FINGERPRINT_FORMAT_VERSION
      ) {
        return failed("RUNTIME_FINGERPRINT_UNAVAILABLE");
      }
      fingerprint = { identityRef: identity.id, config: identity.config };
    } catch {
      // Do not regenerate, expose storage errors, or continue without the identity.
      return failed("RUNTIME_FINGERPRINT_UNAVAILABLE");
    }

    return this.prepare(snapshot, fingerprint);
  }

  private validateInput(
    input: RuntimeLaunchInput,
  ): RuntimeLaunchFailedBeforeSpawn | null {
    if (
      !uuidSchema.safeParse(input.runId).success ||
      !uuidSchema.safeParse(input.profileId).success ||
      this.profilesDirectory.includes("\0") ||
      !isAbsolute(this.profilesDirectory) ||
      input.profileDirectory.includes("\0") ||
      !isAbsolute(input.profileDirectory) ||
      resolve(input.profileDirectory) !==
        resolve(join(this.profilesDirectory, input.profileId))
    ) {
      return failed("RUNTIME_LAUNCH_INPUT_INVALID");
    }
    // The SDK always supplies --fingerprint-profile. Do not treat {} as disabled.
    if (input.identityRef === null) {
      return failed("RUNTIME_FINGERPRINT_MODE_UNSUPPORTED");
    }
    if (
      input.identityRef.trim().length === 0 ||
      input.identityRef.startsWith("test-identity:")
    ) {
      return failed("RUNTIME_FINGERPRINT_UNAVAILABLE");
    }
    return null;
  }
}
