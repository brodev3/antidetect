import { expect, test } from "vitest";
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
  private nextProfileCode = 1;

  async create(profile: ProfileDraft): Promise<Profile> {
    const createdProfile: Profile = {
      ...profile,
      profileCode: `profile-${String(this.nextProfileCode).padStart(3, "0")}`,
    };
    this.nextProfileCode += 1;
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

  async list(options: ProfileListOptions): Promise<readonly Profile[]> {
    this.lastListOptions = options;
    return this.profiles.slice(options.offset, options.offset + options.limit);
  }
}

const firstProfile: Profile = {
  id: "00000000-0000-4000-8000-000000000001",
  profileCode: "profile-001",
  displayName: "First",
  fingerprintEnabled: true,
  identityRef: "test-identity:00000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
};

test("creates server-owned profile fields", async () => {
  const repository = new InMemoryProfileRepository();
  const service = new ProfileService(repository, {
    createId: () => firstProfile.id,
    now: () => firstProfile.createdAt,
  });

  await expect(
    service.create({ displayName: "First", fingerprintEnabled: true }),
  ).resolves.toEqual(firstProfile);
  expect(repository.profiles).toEqual([firstProfile]);
});

test("creates a profile without assigning a fingerprint reference", async () => {
  const repository = new InMemoryProfileRepository();
  const service = new ProfileService(repository, {
    createId: () => firstProfile.id,
    now: () => firstProfile.createdAt,
  });

  await expect(
    service.create({ displayName: "Direct", fingerprintEnabled: false }),
  ).resolves.toMatchObject({
    fingerprintEnabled: false,
    identityRef: null,
  });
});

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
