import { expect, test } from "vitest";
import type { FingerprintIdentity } from "../src/application/fingerprints/fingerprint.identity.repository.ts";
import { ProfileNotFoundError } from "../src/application/profiles/profile.errors.ts";
import type {
  Profile,
  ProfileDraft,
  ProfileFingerprintSettings,
  ProfileListOptions,
  ProfileRepository,
} from "../src/application/profiles/profile.repository.ts";
import { ProfileService } from "../src/application/profiles/profile.service.ts";

class InMemoryProfileRepository implements ProfileRepository {
  readonly profiles: Profile[] = [];
  lastListOptions: ProfileListOptions | undefined;

  async create(profile: ProfileDraft): Promise<Profile> {
    const createdProfile: Profile = {
      ...profile,
      fingerprintPlatform: profile.fingerprintPlatform ?? "Windows",
      profileCode: `profile-${String(this.profiles.length + 1).padStart(3, "0")}`,
    };
    this.profiles.push(createdProfile);
    return createdProfile;
  }

  async findById(id: string): Promise<Profile | null> {
    return this.profiles.find((profile) => profile.id === id) ?? null;
  }

  async updateFingerprintSettings(
    id: string,
    settings: ProfileFingerprintSettings,
  ): Promise<Profile | null> {
    const index = this.profiles.findIndex((profile) => profile.id === id);
    const profile = this.profiles[index];
    if (profile === undefined) return null;

    const updatedProfile = { ...profile, ...settings };
    this.profiles[index] = updatedProfile;
    return updatedProfile;
  }

  async enableFingerprintWithIdentity(
    id: string,
    identity: FingerprintIdentity,
    updatedAt: string,
  ): Promise<Profile | null> {
    const index = this.profiles.findIndex((profile) => profile.id === id);
    const profile = this.profiles[index];
    if (profile === undefined) return null;

    const updatedProfile = {
      ...profile,
      fingerprintEnabled: true,
      identityRef: identity.id,
      updatedAt,
    };
    this.profiles[index] = updatedProfile;
    return updatedProfile;
  }

  async replaceFingerprintIdentity(
    id: string,
    identity: FingerprintIdentity,
    updatedAt: string,
    fingerprintPlatform?: Profile["fingerprintPlatform"],
  ): Promise<Profile | null> {
    const index = this.profiles.findIndex((profile) => profile.id === id);
    const profile = this.profiles[index];
    if (profile === undefined) return null;

    const updatedProfile = {
      ...profile,
      ...(fingerprintPlatform === undefined ? {} : { fingerprintPlatform }),
      identityRef: identity.id,
      updatedAt,
    };
    this.profiles[index] = updatedProfile;
    return updatedProfile;
  }

  async list(options: ProfileListOptions): Promise<readonly Profile[]> {
    this.lastListOptions = options;
    return this.profiles.slice(options.offset, options.offset + options.limit);
  }
}

const firstProfile: Profile = {
  id: "00000000-0000-4000-8000-000000000001",
  profileCode: "profile-001",
  displayName: "First",
  fingerprintPlatform: "Windows",
  fingerprintEnabled: true,
  identityRef: "test-identity:00000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
};

test("returns a profile or a typed not-found error", async () => {
  const repository = new InMemoryProfileRepository();
  repository.profiles.push(firstProfile);
  const service = new ProfileService(repository);

  await expect(service.getById(firstProfile.id)).resolves.toEqual(firstProfile);
  await expect(
    service.getById("00000000-0000-4000-8000-000000000099"),
  ).rejects.toBeInstanceOf(ProfileNotFoundError);
});

test("requests one extra row and calculates the next offset", async () => {
  const repository = new InMemoryProfileRepository();
  repository.profiles.push(
    firstProfile,
    { ...firstProfile, id: "00000000-0000-4000-8000-000000000002" },
    { ...firstProfile, id: "00000000-0000-4000-8000-000000000003" },
  );
  const service = new ProfileService(repository);

  await expect(
    service.list({
      limit: 2,
      offset: 0,
      search: undefined,
      sortBy: "createdAt",
      sortOrder: "asc",
    }),
  ).resolves.toEqual({
    items: repository.profiles.slice(0, 2),
    nextOffset: 2,
  });
  expect(repository.lastListOptions).toEqual({
    limit: 3,
    offset: 0,
    search: undefined,
    sortBy: "createdAt",
    sortOrder: "asc",
  });

  await expect(
    service.list({
      limit: 2,
      offset: 2,
      search: "first",
      sortBy: "displayName",
      sortOrder: "desc",
    }),
  ).resolves.toEqual({
    items: repository.profiles.slice(2),
    nextOffset: null,
  });
  expect(repository.lastListOptions).toEqual({
    limit: 3,
    offset: 2,
    search: "first",
    sortBy: "displayName",
    sortOrder: "desc",
  });
});
