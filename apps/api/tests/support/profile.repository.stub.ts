import type {
  Profile,
  ProfileDraft,
  ProfileRepository,
} from "../../src/application/profiles/profile.repository.js";

export function createProfileRepositoryStub(): ProfileRepository {
  return {
    async create(profile: ProfileDraft): Promise<Profile> {
      return { ...profile, profileCode: "profile-001" };
    },
    async findById(): Promise<Profile | null> {
      return null;
    },
    async updateFingerprintSettings(): Promise<Profile | null> {
      return null;
    },
    async list(): Promise<readonly Profile[]> {
      return [];
    },
  };
}
