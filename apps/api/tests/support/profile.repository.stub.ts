import type {
  Profile,
  ProfileDraft,
  ProfileFingerprintCreationRepository,
  ProfileRepository,
} from "../../src/application/profiles/profile.repository.js";
import { DEFAULT_FINGERPRINT_PLATFORM } from "../../src/application/fingerprints/fingerprint.generator.js";

export function createProfileRepositoryStub(): ProfileRepository &
  ProfileFingerprintCreationRepository {
  return {
    async create(profile: ProfileDraft): Promise<Profile> {
      return {
        ...profile,
        fingerprintPlatform:
          profile.fingerprintPlatform ?? DEFAULT_FINGERPRINT_PLATFORM,
        profileCode: "profile-001",
      };
    },
    async createWithFingerprint(profile, identity): Promise<Profile> {
      return {
        ...profile,
        fingerprintPlatform:
          profile.fingerprintPlatform ?? DEFAULT_FINGERPRINT_PLATFORM,
        profileCode: "profile-001",
        fingerprintEnabled: true,
        identityRef: identity.id,
      };
    },
    async findById(): Promise<Profile | null> {
      return null;
    },
    async updateFingerprintSettings(): Promise<Profile | null> {
      return null;
    },
    async enableFingerprintWithIdentity(): Promise<Profile | null> {
      return null;
    },
    async replaceFingerprintIdentity(): Promise<Profile | null> {
      return null;
    },
    async list(): Promise<readonly Profile[]> {
      return [];
    },
  };
}
