import { randomUUID } from "node:crypto";
import {
  DEFAULT_FINGERPRINT_PLATFORM,
  type FingerprintGenerator,
  type FingerprintPlatform,
} from "../fingerprints/fingerprint.generator.js";
import { FINGERPRINT_FORMAT_VERSION } from "../fingerprints/fingerprint.identity.repository.js";
import type {
  Profile,
  ProfileFingerprintCreationRepository,
  ProfileRepository,
} from "./profile.repository.js";

export interface CreateProfileInput {
  readonly displayName: string;
  readonly fingerprintEnabled: boolean;
  readonly fingerprintPlatform?: FingerprintPlatform;
}

export interface ProfileCreationServiceDependencies {
  readonly createId: () => string;
  readonly now: () => string;
}

const defaultDependencies: ProfileCreationServiceDependencies = {
  createId: randomUUID,
  now: () => new Date().toISOString(),
};

export class ProfileCreationService {
  constructor(
    private readonly repository: Pick<ProfileRepository, "create"> &
      ProfileFingerprintCreationRepository,
    private readonly generator: FingerprintGenerator,
    private readonly dependencies: ProfileCreationServiceDependencies = defaultDependencies,
  ) {}

  async create(input: CreateProfileInput): Promise<Profile> {
    const id = this.dependencies.createId();
    const displayName = input.displayName;
    const fingerprintEnabled = input.fingerprintEnabled;
    const fingerprintPlatform =
      input.fingerprintPlatform ?? DEFAULT_FINGERPRINT_PLATFORM;

    if (!fingerprintEnabled) {
      const timestamp = this.dependencies.now();
      return this.repository.create({
        id,
        displayName,
        fingerprintPlatform,
        fingerprintEnabled: false,
        identityRef: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    const identityId = this.dependencies.createId();
    // Generation may be slow or fail; do not open the persistence transaction yet.
    const config = await this.generator.generate(identityId, fingerprintPlatform);
    const timestamp = this.dependencies.now();

    return this.repository.createWithFingerprint(
      {
        id,
        displayName,
        fingerprintPlatform,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: identityId,
        formatVersion: FINGERPRINT_FORMAT_VERSION,
        config,
        createdAt: timestamp,
      },
    );
  }
}
