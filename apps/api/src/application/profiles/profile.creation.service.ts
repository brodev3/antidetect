import { randomUUID } from "node:crypto";
import type { FingerprintGenerator } from "../fingerprints/fingerprint.generator.js";
import { FINGERPRINT_FORMAT_VERSION } from "../fingerprints/fingerprint.identity.repository.js";
import type {
  Profile,
  ProfileFingerprintCreationRepository,
  ProfileRepository,
} from "./profile.repository.js";
import type {
  CreateProfileInput,
  ProfileServiceDependencies,
} from "./profile.service.js";

const defaultDependencies: ProfileServiceDependencies = {
  createId: randomUUID,
  now: () => new Date().toISOString(),
};

export class ProfileCreationService {
  constructor(
    private readonly repository: Pick<ProfileRepository, "create"> &
      ProfileFingerprintCreationRepository,
    private readonly generator: FingerprintGenerator,
    private readonly dependencies: ProfileServiceDependencies = defaultDependencies,
  ) {}

  async create(input: CreateProfileInput): Promise<Profile> {
    const id = this.dependencies.createId();
    const displayName = input.displayName;
    const fingerprintEnabled = input.fingerprintEnabled;

    if (!fingerprintEnabled) {
      const timestamp = this.dependencies.now();
      return this.repository.create({
        id,
        displayName,
        fingerprintEnabled: false,
        identityRef: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    const identityId = this.dependencies.createId();
    // Generation may be slow or fail; do not open the persistence transaction yet.
    const config = await this.generator.generate(identityId);
    const timestamp = this.dependencies.now();

    return this.repository.createWithFingerprint(
      { id, displayName, createdAt: timestamp, updatedAt: timestamp },
      {
        id: identityId,
        formatVersion: FINGERPRINT_FORMAT_VERSION,
        config,
        createdAt: timestamp,
      },
    );
  }
}
