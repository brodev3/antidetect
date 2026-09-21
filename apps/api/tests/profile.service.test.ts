import { expect, test } from "vitest";
import { ProfileNotFoundError } from "../src/application/profiles/profile.errors.ts";
import type {
  Profile,
  ProfileListOptions,
  ProfileRepository,
} from "../src/application/profiles/profile.repository.ts";
import { ProfileService } from "../src/application/profiles/profile.service.ts";

class InMemoryProfileRepository implements ProfileRepository {
  readonly profiles: Profile[] = [];
  lastListOptions: ProfileListOptions | undefined;

  async create(profile: Profile): Promise<Profile> {
    this.profiles.push(profile);
    return profile;
  }

  async findById(id: string): Promise<Profile | null> {
    return this.profiles.find((profile) => profile.id === id) ?? null;
  }

  async list(options: ProfileListOptions): Promise<readonly Profile[]> {
    this.lastListOptions = options;
    return this.profiles.slice(options.offset, options.offset + options.limit);
  }
}

const firstProfile: Profile = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "First",
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

  await expect(service.create({ displayName: "First" })).resolves.toEqual(firstProfile);
  expect(repository.profiles).toEqual([firstProfile]);
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

  await expect(service.list({ limit: 2, offset: 0 })).resolves.toEqual({
    items: repository.profiles.slice(0, 2),
    nextOffset: 2,
  });
  expect(repository.lastListOptions).toEqual({ limit: 3, offset: 0 });

  await expect(service.list({ limit: 2, offset: 2 })).resolves.toEqual({
    items: repository.profiles.slice(2),
    nextOffset: null,
  });
});
