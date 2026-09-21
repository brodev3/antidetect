import type {
  Profile,
  ProfileRepository,
} from "../../src/application/profiles/profile.repository.js";

export function createProfileRepositoryStub(): ProfileRepository {
  return {
    async create(profile: Profile): Promise<Profile> {
      return profile;
    },
    async findById(): Promise<Profile | null> {
      return null;
    },
    async list(): Promise<readonly Profile[]> {
      return [];
    },
  };
}
