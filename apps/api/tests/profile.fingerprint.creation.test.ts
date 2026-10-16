import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { InvalidFingerprintIdentityError } from "../src/application/fingerprints/fingerprint.identity.errors.ts";
import {
  FINGERPRINT_FORMAT_VERSION,
  type FingerprintIdentity,
} from "../src/application/fingerprints/fingerprint.identity.repository.ts";
import {
  createAppDatabase,
  type AppDatabase,
} from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";
import { SqliteFingerprintIdentityRepository } from "../src/infrastructure/sqlite/sqlite.fingerprint.identity.repository.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";

const profile = {
  id: "f4ace6a0-5049-46af-8b49-797b2216cc2e",
  displayName: "Research profile",
  fingerprintPlatform: "Windows",
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: "2026-10-05T10:00:00.000Z",
} as const;

const identity: FingerprintIdentity = {
  id: "cf7c7db4-0b0b-470d-b0ca-2866505e95a1",
  formatVersion: FINGERPRINT_FORMAT_VERSION,
  config: { navigator: { platform: "Windows", languages: ["en-US"] } },
  createdAt: profile.createdAt,
};

const expectedProfile = {
  ...profile,
  profileCode: "profile-001",
  fingerprintEnabled: true,
  identityRef: identity.id,
};

async function withDatabase(
  callback: (database: AppDatabase) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), "antidetect-profile-fingerprint-"));
  const owner = acquireRootOwnership(join(root, "antidetect.sqlite"));
  const database = createAppDatabase(owner);
  try {
    await runMigrations(database);
    await callback(database);
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function expectEmptyCreation(database: AppDatabase): Promise<void> {
  await expect(database.selectFrom("profiles").selectAll().execute()).resolves.toEqual(
    [],
  );
  await expect(
    database.selectFrom("fingerprint_identities").selectAll().execute(),
  ).resolves.toEqual([]);
  await expect(
    database.selectFrom("profile_code_sequence").selectAll().execute(),
  ).resolves.toEqual([{ id: 1, next_value: 1 }]);
}

test("atomically creates a profile and fingerprint that survive reopening SQLite", async () => {
  const root = await fs.mkdtemp(
    join(tmpdir(), "antidetect-profile-fingerprint-reopen-"),
  );
  try {
    for (const round of [0, 1]) {
      const owner = acquireRootOwnership(join(root, "antidetect.sqlite"));
      const database = createAppDatabase(owner);
      try {
        await runMigrations(database);
        const profiles = new SqliteProfileRepository(database);
        const identities = new SqliteFingerprintIdentityRepository(database);
        if (round === 0) {
          const transaction = vi.spyOn(database, "transaction");
          try {
            await expect(
              profiles.createWithFingerprint(profile, identity),
            ).resolves.toEqual(expectedProfile);
            expect(transaction).toHaveBeenCalledTimes(1);
          } finally {
            transaction.mockRestore();
          }
        }
        await expect(profiles.findById(profile.id)).resolves.toEqual(expectedProfile);
        await expect(identities.findById(identity.id)).resolves.toEqual(identity);
        await expect(
          database.selectFrom("profile_code_sequence").selectAll().execute(),
        ).resolves.toEqual([{ id: 1, next_value: 2 }]);
      } finally {
        await database.destroy();
        owner.close();
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rolls back the fingerprint and allocated code if profile insertion fails", async () => {
  await withDatabase(async (database) => {
    const repository = new SqliteProfileRepository(database);
    await expect(
      repository.createWithFingerprint({ ...profile, displayName: " " }, identity),
    ).rejects.toThrow();
    await expectEmptyCreation(database);
    await expect(repository.createWithFingerprint(profile, identity)).resolves.toEqual(
      expectedProfile,
    );
  });
});

test("preserves an existing profile and rolls back a new identity on duplicate profile id", async () => {
  await withDatabase(async (database) => {
    const repository = new SqliteProfileRepository(database);
    const existing = await repository.create({
      ...profile,
      fingerprintEnabled: false,
      identityRef: null,
    });
    await expect(repository.createWithFingerprint(profile, identity)).rejects.toThrow();
    await expect(repository.findById(profile.id)).resolves.toEqual(existing);
    await expect(
      new SqliteFingerprintIdentityRepository(database).findById(identity.id),
    ).resolves.toBeNull();
    const nextProfile = await repository.createWithFingerprint(
      { ...profile, id: "51b7b0bc-ef2a-4a7b-8591-151e5ff2d7d0" },
      identity,
    );
    expect(nextProfile.profileCode).toBe("profile-002");
  });
});

test("does not overwrite an existing fingerprint or create a profile on duplicate identity id", async () => {
  await withDatabase(async (database) => {
    const identities = new SqliteFingerprintIdentityRepository(database);
    await identities.create(identity);
    await expect(
      new SqliteProfileRepository(database).createWithFingerprint(profile, {
        ...identity,
        config: { different: true },
      }),
    ).rejects.toThrow();
    await expect(identities.findById(identity.id)).resolves.toEqual(identity);
    await expect(
      database.selectFrom("profiles").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      database.selectFrom("profile_code_sequence").selectAll().execute(),
    ).resolves.toEqual([{ id: 1, next_value: 1 }]);
  });
});

test("rolls back the identity if profile code allocation fails", async () => {
  await withDatabase(async (database) => {
    await database.deleteFrom("profile_code_sequence").execute();
    const repository = new SqliteProfileRepository(database);
    await expect(repository.createWithFingerprint(profile, identity)).rejects.toThrow(
      "Profile code sequence is not initialized",
    );
    await expect(
      database.selectFrom("fingerprint_identities").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      database.selectFrom("profiles").selectAll().execute(),
    ).resolves.toEqual([]);
    await database
      .insertInto("profile_code_sequence")
      .values({ id: 1, next_value: 1 })
      .execute();
    await expect(repository.createWithFingerprint(profile, identity)).resolves.toEqual(
      expectedProfile,
    );
  });
});

test.each([
  ["invalid UUID", { ...identity, id: "not-a-uuid" }],
  ["unsupported version", { ...identity, formatVersion: 2 }],
  ["empty config", { ...identity, config: {} }],
  ["invalid timestamp", { ...identity, createdAt: "not-a-date" }],
  ["non-JSON date", { ...identity, config: { value: new Date() } }],
  ["non-JSON bigint", { ...identity, config: { value: 1n } }],
  ["non-JSON function", { ...identity, config: { value: () => "private data" } }],
  ["non-JSON undefined", { ...identity, config: { value: undefined } }],
])(
  "rejects %s without saving either record or consuming a profile code",
  async (_, invalidIdentity) => {
    await withDatabase(async (database) => {
      await expect(
        new SqliteProfileRepository(database).createWithFingerprint(
          profile,
          invalidIdentity,
        ),
      ).rejects.toThrow(InvalidFingerprintIdentityError);
      await expectEmptyCreation(database);
    });
  },
);

test("snapshots both inputs before awaiting and derives the fingerprint reference", async () => {
  await withDatabase(async (database) => {
    const config = { navigator: { platform: "Windows", languages: ["en-US"] } };
    const mutableIdentity = { ...identity, config };
    const metadata = {
      ...profile,
      displayName: "Research profile",
      fingerprintEnabled: false,
      identityRef: "unrelated-identity",
      config: "must not enter the profile response",
    };
    const repository = new SqliteProfileRepository(database);
    const pending = repository.createWithFingerprint(metadata, mutableIdentity);
    metadata.displayName = "Changed";
    mutableIdentity.id = "d30b059f-0cce-4a5b-b7a8-9aa0c0bcb42a";
    config.navigator.languages.push("ru-RU");
    const created = await pending;
    expect(created).toEqual(expectedProfile);
    await expect(repository.findById(profile.id)).resolves.toEqual(expectedProfile);
    await expect(
      new SqliteFingerprintIdentityRepository(database).findById(identity.id),
    ).resolves.toEqual(identity);
  });
});

test("sanitizes cloning errors without saving data or exposing the cause", async () => {
  await withDatabase(async (database) => {
    const malformed = { ...identity };
    Object.defineProperty(malformed, "config", {
      enumerable: true,
      get() {
        throw new Error("private-config-sentinel");
      },
    });
    const error = await new SqliteProfileRepository(database)
      .createWithFingerprint(profile, malformed)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidFingerprintIdentityError);
    expect(error).toMatchObject({
      code: "INVALID_FINGERPRINT_IDENTITY",
      message: "Fingerprint identity is invalid or unsupported",
    });
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("private-config-sentinel");
    await expectEmptyCreation(database);
  });
});
