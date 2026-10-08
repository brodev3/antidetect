import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import {
  FingerprintGenerationError,
  type FingerprintGenerator,
} from "../src/application/fingerprints/fingerprint.generator.ts";
import { FINGERPRINT_FORMAT_VERSION } from "../src/application/fingerprints/fingerprint.identity.repository.ts";
import { ProfileCreationService } from "../src/application/profiles/profile.creation.service.ts";
import type {
  ProfileFingerprintCreationRepository,
  ProfileRepository,
} from "../src/application/profiles/profile.repository.ts";
import {
  createAppDatabase,
  type AppDatabase,
} from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import {
  acquireRootOwnership,
  type RootOwnership,
} from "../src/infrastructure/sqlite/root.ownership.ts";
import { SqliteFingerprintIdentityRepository } from "../src/infrastructure/sqlite/sqlite.fingerprint.identity.repository.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";

const profileId = "f4ace6a0-5049-46af-8b49-797b2216cc2e";
const identityId = "cf7c7db4-0b0b-470d-b0ca-2866505e95a1";
const secondProfileId = "51b7b0bc-ef2a-4a7b-8591-151e5ff2d7d0";
const secondIdentityId = "d30b059f-0cce-4a5b-b7a8-9aa0c0bcb42a";
const timestamp = "2026-10-05T10:00:00.000Z";
const config = { navigator: { platform: "Windows", languages: ["en-US"] } };
const metadata = {
  id: profileId,
  displayName: "Research profile",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const expectedProfile = {
  ...metadata,
  profileCode: "profile-001",
  fingerprintEnabled: true,
  identityRef: identityId,
};

function buildSubject() {
  const repository = {
    create: vi.fn<ProfileRepository["create"]>().mockImplementation(async (draft) => ({
      ...draft,
      profileCode: "profile-001",
    })),
    createWithFingerprint: vi
      .fn<ProfileFingerprintCreationRepository["createWithFingerprint"]>()
      .mockImplementation(async (draft, identity) => ({
        ...draft,
        profileCode: "profile-001",
        fingerprintEnabled: true,
        identityRef: identity.id,
      })),
  };
  const generator = {
    generate: vi.fn<FingerprintGenerator["generate"]>().mockResolvedValue(config),
  };
  const dependencies = {
    createId: vi
      .fn<() => string>()
      .mockReturnValueOnce(profileId)
      .mockReturnValueOnce(identityId),
    now: vi.fn<() => string>().mockReturnValue(timestamp),
  };
  const service = new ProfileCreationService(repository, generator, dependencies);
  return { service, repository, generator, dependencies };
}

async function withDatabase(
  callback: (database: AppDatabase, owner: RootOwnership) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), "antidetect-profile-creation-service-"));
  const owner = acquireRootOwnership(join(root, "antidetect.sqlite"));
  const database = createAppDatabase(owner);
  try {
    await runMigrations(database);
    await callback(database, owner);
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("generates a fingerprint and passes server-owned metadata to atomic persistence", async () => {
  const { service, repository, generator, dependencies } = buildSubject();
  await expect(
    service.create({ displayName: metadata.displayName, fingerprintEnabled: true }),
  ).resolves.toEqual(expectedProfile);
  expect(generator.generate).toHaveBeenCalledExactlyOnceWith(identityId);
  expect(repository.createWithFingerprint).toHaveBeenCalledExactlyOnceWith(metadata, {
    id: identityId,
    formatVersion: FINGERPRINT_FORMAT_VERSION,
    config,
    createdAt: timestamp,
  });
  expect(repository.create).not.toHaveBeenCalled();
  expect(dependencies.createId).toHaveBeenCalledTimes(2);
  expect(dependencies.now).toHaveBeenCalledTimes(1);
});

test("does not call persistence or choose timestamps until generation has completed", async () => {
  const { service, repository, generator, dependencies } = buildSubject();
  let completeGeneration: ((value: typeof config) => void) | undefined;
  generator.generate.mockReturnValue(
    new Promise<typeof config>((resolve) => {
      completeGeneration = resolve;
    }),
  );
  const input = { displayName: metadata.displayName, fingerprintEnabled: true };
  const pending = service.create(input);
  expect(generator.generate).toHaveBeenCalledExactlyOnceWith(identityId);
  expect(repository.create).not.toHaveBeenCalled();
  expect(repository.createWithFingerprint).not.toHaveBeenCalled();
  expect(dependencies.now).not.toHaveBeenCalled();
  input.displayName = "Changed while generating";
  input.fingerprintEnabled = false;
  if (completeGeneration === undefined) throw new Error("Generation was not started");
  completeGeneration(config);
  await expect(pending).resolves.toEqual(expectedProfile);
  expect(repository.create).not.toHaveBeenCalled();
});

test("creates without a fingerprint even if the generator cannot be used", async () => {
  const { service, repository, generator, dependencies } = buildSubject();
  generator.generate.mockRejectedValue(
    new FingerprintGenerationError("RUNTIME_NOT_INSTALLED"),
  );
  await expect(
    service.create({ displayName: metadata.displayName, fingerprintEnabled: false }),
  ).resolves.toEqual({
    ...expectedProfile,
    fingerprintEnabled: false,
    identityRef: null,
  });
  expect(repository.create).toHaveBeenCalledExactlyOnceWith({
    ...metadata,
    fingerprintEnabled: false,
    identityRef: null,
  });
  expect(repository.createWithFingerprint).not.toHaveBeenCalled();
  expect(generator.generate).not.toHaveBeenCalled();
  expect(dependencies.createId).toHaveBeenCalledTimes(1);
});

test.each(["RUNTIME_NOT_INSTALLED", "FINGERPRINT_GENERATION_FAILED"] as const)(
  "propagates %s without writing, retrying or falling back to a test identity",
  async (code) => {
    const { service, repository, generator, dependencies } = buildSubject();
    const error = new FingerprintGenerationError(code);
    generator.generate.mockRejectedValue(error);
    await expect(
      service.create({ displayName: metadata.displayName, fingerprintEnabled: true }),
    ).rejects.toBe(error);
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.createWithFingerprint).not.toHaveBeenCalled();
    expect(dependencies.now).not.toHaveBeenCalled();
  },
);

test("propagates persistence failure without regenerating or falling back", async () => {
  const { service, repository, generator } = buildSubject();
  const error = new Error("Persistence failed");
  repository.createWithFingerprint.mockRejectedValue(error);
  await expect(
    service.create({ displayName: metadata.displayName, fingerprintEnabled: true }),
  ).rejects.toBe(error);
  expect(generator.generate).toHaveBeenCalledTimes(1);
  expect(repository.createWithFingerprint).toHaveBeenCalledTimes(1);
  expect(repository.create).not.toHaveBeenCalled();
});

test("creates a fresh profile and fingerprint identity for each attempt", async () => {
  const { service, repository, generator, dependencies } = buildSubject();
  dependencies.createId
    .mockReturnValueOnce(secondProfileId)
    .mockReturnValueOnce(secondIdentityId);
  await service.create({ displayName: "First", fingerprintEnabled: true });
  await service.create({ displayName: "Second", fingerprintEnabled: true });
  expect(generator.generate.mock.calls).toEqual([[identityId], [secondIdentityId]]);
  expect(
    repository.createWithFingerprint.mock.calls.map(([draft, identity]) => [
      draft.id,
      identity.id,
    ]),
  ).toEqual([
    [profileId, identityId],
    [secondProfileId, secondIdentityId],
  ]);
});

test("does not trust extra client fields for profile or fingerprint metadata", async () => {
  const { service, repository } = buildSubject();
  const input = {
    displayName: metadata.displayName,
    fingerprintEnabled: true,
    id: "client-profile-id",
    identityRef: "client-identity-id",
    createdAt: "client-timestamp",
    config: { private: true },
  };
  await expect(service.create(input)).resolves.toEqual(expectedProfile);
  expect(repository.createWithFingerprint).toHaveBeenCalledExactlyOnceWith(metadata, {
    id: identityId,
    formatVersion: FINGERPRINT_FORMAT_VERSION,
    config,
    createdAt: timestamp,
  });
});

test("uses UUIDs and matching UTC timestamps with default dependencies", async () => {
  const { repository, generator } = buildSubject();
  const created = await new ProfileCreationService(repository, generator).create({
    displayName: "Default metadata",
    fingerprintEnabled: true,
  });
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  expect(created.id).toMatch(uuidPattern);
  expect(created.identityRef).toMatch(uuidPattern);
  expect(created.id).not.toBe(created.identityRef);
  expect(created.createdAt).toBe(created.updatedAt);
  expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
  expect(generator.generate).toHaveBeenCalledExactlyOnceWith(created.identityRef);
});

test("holds no SQLite transaction while generating and allows creation without a fingerprint", async () => {
  await withDatabase(async (database, owner) => {
    let completeGeneration: ((value: typeof config) => void) | undefined;
    const generator = {
      generate: vi.fn<FingerprintGenerator["generate"]>().mockReturnValue(
        new Promise<typeof config>((resolve) => {
          completeGeneration = resolve;
        }),
      ),
    };
    const service = new ProfileCreationService(
      new SqliteProfileRepository(database),
      generator,
      {
        createId: vi
          .fn<() => string>()
          .mockReturnValueOnce(profileId)
          .mockReturnValueOnce(identityId)
          .mockReturnValueOnce(secondProfileId),
        now: () => timestamp,
      },
    );
    const transaction = vi.spyOn(database, "transaction");
    let pending: ReturnType<ProfileCreationService["create"]> | undefined;
    try {
      pending = service.create({
        displayName: metadata.displayName,
        fingerprintEnabled: true,
      });
      expect(owner.sqlite.inTransaction).toBe(false);
      expect(transaction).not.toHaveBeenCalled();
      await expect(
        database.selectFrom("profiles").selectAll().execute(),
      ).resolves.toEqual([]);
      await expect(
        database.selectFrom("fingerprint_identities").selectAll().execute(),
      ).resolves.toEqual([]);
      await expect(
        service.create({ displayName: "No fingerprint", fingerprintEnabled: false }),
      ).resolves.toMatchObject({
        id: secondProfileId,
        profileCode: "profile-001",
        fingerprintEnabled: false,
        identityRef: null,
      });
      expect(generator.generate).toHaveBeenCalledTimes(1);
      expect(transaction).toHaveBeenCalledTimes(1);
      if (completeGeneration === undefined)
        throw new Error("Generation was not started");
      completeGeneration(config);
      await expect(pending).resolves.toEqual({
        ...expectedProfile,
        profileCode: "profile-002",
      });
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(owner.sqlite.inTransaction).toBe(false);
      await expect(
        new SqliteFingerprintIdentityRepository(database).findById(identityId),
      ).resolves.toEqual({
        id: identityId,
        formatVersion: FINGERPRINT_FORMAT_VERSION,
        config,
        createdAt: timestamp,
      });
    } finally {
      completeGeneration?.(config);
      await pending?.catch(() => undefined);
      transaction.mockRestore();
    }
  });
});

test("leaves SQLite unchanged after a generation error", async () => {
  await withDatabase(async (database) => {
    const error = new FingerprintGenerationError("RUNTIME_NOT_INSTALLED");
    const service = new ProfileCreationService(new SqliteProfileRepository(database), {
      generate: vi.fn<FingerprintGenerator["generate"]>().mockRejectedValue(error),
    });
    const transaction = vi.spyOn(database, "transaction");
    try {
      await expect(
        service.create({ displayName: metadata.displayName, fingerprintEnabled: true }),
      ).rejects.toBe(error);
      expect(transaction).not.toHaveBeenCalled();
      await expect(
        database.selectFrom("profiles").selectAll().execute(),
      ).resolves.toEqual([]);
      await expect(
        database.selectFrom("fingerprint_identities").selectAll().execute(),
      ).resolves.toEqual([]);
      await expect(
        database.selectFrom("profile_code_sequence").selectAll().execute(),
      ).resolves.toEqual([{ id: 1, next_value: 1 }]);
    } finally {
      transaction.mockRestore();
    }
  });
});

test("rolls back a generated identity and profile code if saving the profile fails", async () => {
  await withDatabase(async (database) => {
    const generator = {
      generate: vi.fn<FingerprintGenerator["generate"]>().mockResolvedValue(config),
    };
    const service = new ProfileCreationService(
      new SqliteProfileRepository(database),
      generator,
    );
    await expect(
      service.create({ displayName: " ", fingerprintEnabled: true }),
    ).rejects.toThrow();
    expect(generator.generate).toHaveBeenCalledTimes(1);
    await expect(
      database.selectFrom("profiles").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      database.selectFrom("fingerprint_identities").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      database.selectFrom("profile_code_sequence").selectAll().execute(),
    ).resolves.toEqual([{ id: 1, next_value: 1 }]);
  });
});

test("reads the generated configuration and profile unchanged after reopening SQLite", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "antidetect-profile-creation-reopen-"));
  const generator = {
    generate: vi.fn<FingerprintGenerator["generate"]>().mockResolvedValue(config),
  };
  try {
    for (const round of [0, 1]) {
      const owner = acquireRootOwnership(join(root, "antidetect.sqlite"));
      const database = createAppDatabase(owner);
      try {
        await runMigrations(database);
        const profiles = new SqliteProfileRepository(database);
        if (round === 0) {
          const service = new ProfileCreationService(profiles, generator, {
            createId: vi
              .fn<() => string>()
              .mockReturnValueOnce(profileId)
              .mockReturnValueOnce(identityId),
            now: () => timestamp,
          });
          await expect(
            service.create({
              displayName: metadata.displayName,
              fingerprintEnabled: true,
            }),
          ).resolves.toEqual(expectedProfile);
        }
        await expect(profiles.findById(profileId)).resolves.toEqual(expectedProfile);
        await expect(
          new SqliteFingerprintIdentityRepository(database).findById(identityId),
        ).resolves.toEqual({
          id: identityId,
          formatVersion: FINGERPRINT_FORMAT_VERSION,
          config,
          createdAt: timestamp,
        });
      } finally {
        await database.destroy();
        owner.close();
      }
    }
    expect(generator.generate).toHaveBeenCalledTimes(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
