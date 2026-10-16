import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { expect, test } from "vitest";
import {
  FINGERPRINT_FORMAT_VERSION,
  type FingerprintIdentity,
} from "../src/application/fingerprints/fingerprint.identity.repository.ts";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { ensureAppRootDirectories } from "../src/infrastructure/filesystem/app.directories.ts";
import { createAppDatabase } from "../src/infrastructure/sqlite/app.database.ts";
import { createProfilesMigration } from "../src/infrastructure/sqlite/migrations/001-create-profiles.ts";
import { createBrowserRunsMigration } from "../src/infrastructure/sqlite/migrations/002-create-browser-runs.ts";
import { addProfileCodesMigration } from "../src/infrastructure/sqlite/migrations/003-add-profile-codes.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";
import { SqliteFingerprintIdentityRepository } from "../src/infrastructure/sqlite/sqlite.fingerprint.identity.repository.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";

const profile = {
  id: "profile-001",
  profileCode: "profile-001",
  displayName: "Research profile",
  fingerprintPlatform: "Windows",
  fingerprintEnabled: true,
  identityRef: "identity-001",
  createdAt: "2026-09-15T10:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
} as const;

test("runs profiles migration idempotently and persists repository data", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-profile-repository-"));
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const firstOwner = acquireRootOwnership(paths.databasePath);
  const firstDatabase = createAppDatabase(firstOwner);
  const expectedReenabledProfile = {
    ...profile,
    updatedAt: "2026-09-24T10:00:00.000Z",
  };

  try {
    await runMigrations(firstDatabase);
    await runMigrations(firstDatabase);

    const migrations = await firstDatabase
      .selectFrom("schema_migrations")
      .selectAll()
      .execute();
    expect(migrations).toHaveLength(4);
    expect(migrations.map((migration) => migration.name)).toEqual([
      createProfilesMigration.name,
      "create_browser_runs",
      "add_profile_codes",
      "create_fingerprint_identities",
    ]);

    const repository = new SqliteProfileRepository(firstDatabase);
    await expect(repository.findById(profile.id)).resolves.toBeNull();
    await expect(repository.create(profile)).resolves.toEqual(profile);
    const disabledProfile = await repository.updateFingerprintSettings(profile.id, {
      fingerprintEnabled: false,
      identityRef: profile.identityRef,
      updatedAt: "2026-09-23T10:00:00.000Z",
    });
    expect(disabledProfile).toEqual({
      ...profile,
      fingerprintEnabled: false,
      updatedAt: "2026-09-23T10:00:00.000Z",
    });
    const reenabledProfile = await repository.updateFingerprintSettings(profile.id, {
      fingerprintEnabled: true,
      identityRef: profile.identityRef,
      updatedAt: "2026-09-24T10:00:00.000Z",
    });
    expect(reenabledProfile).toEqual(expectedReenabledProfile);
    await expect(
      repository.updateFingerprintSettings("missing", {
        fingerprintEnabled: false,
        identityRef: null,
        updatedAt: "2026-09-25T10:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.list({
        limit: 50,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "asc",
      }),
    ).resolves.toEqual([expectedReenabledProfile]);
    await expect(
      repository.create({ ...profile, id: "profile-empty", displayName: "" }),
    ).rejects.toThrow();
  } finally {
    firstOwner.close();
  }

  const secondOwner = acquireRootOwnership(paths.databasePath);
  const secondDatabase = createAppDatabase(secondOwner);

  try {
    await runMigrations(secondDatabase);
    await expect(
      new SqliteProfileRepository(secondDatabase).findById(profile.id),
    ).resolves.toEqual(expectedReenabledProfile);
  } finally {
    secondOwner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("adds a default platform to existing profiles and constrains new values", async () => {
  const tempRoot = await fs.mkdtemp(
    join(tmpdir(), "antidetect-profile-platform-migration-"),
  );
  const owner = acquireRootOwnership(join(tempRoot, "antidetect.sqlite"));
  const database = createAppDatabase(owner);

  try {
    await sql`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `.execute(database);

    const previousMigrations = [
      createProfilesMigration,
      createBrowserRunsMigration,
      addProfileCodesMigration,
    ] as const;
    for (const migration of previousMigrations) {
      await migration.up(database);
      await database
        .insertInto("schema_migrations")
        .values({
          version: migration.version,
          name: migration.name,
          applied_at: "2026-10-17T00:00:00.000Z",
        })
        .execute();
    }

    await sql`
      INSERT INTO profiles (
        id, profile_code, display_name, identity_ref, fingerprint_enabled,
        created_at, updated_at
      ) VALUES (
        'legacy-profile', 'profile-001', 'Existing profile', 'legacy-identity',
        1, '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:00.000Z'
      )
    `.execute(database);

    await runMigrations(database);

    await expect(
      database
        .selectFrom("profiles")
        .select(["id", "fingerprint_platform"])
        .where("id", "=", "legacy-profile")
        .executeTakeFirst(),
    ).resolves.toEqual({
      id: "legacy-profile",
      fingerprint_platform: "Windows",
    });
    await expect(
      sql`UPDATE profiles SET fingerprint_platform = 'Android' WHERE id = 'legacy-profile'`.execute(
        database,
      ),
    ).rejects.toThrow();
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejects a duplicate profile id at the SQLite boundary", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-profile-duplicate-"));
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);

  try {
    await runMigrations(database);
    const repository = new SqliteProfileRepository(database);
    await repository.create(profile);

    await expect(
      repository.create({ ...profile, displayName: "Duplicate" }),
    ).rejects.toThrow();
    await expect(
      sql`select count(*) as count from profiles`.execute(database),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  } finally {
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("atomically saves a newly enabled fingerprint identity and profile setting", async () => {
  const tempRoot = await fs.mkdtemp(
    join(tmpdir(), "antidetect-profile-fingerprint-enable-"),
  );
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);
  const disabledProfile = {
    ...profile,
    fingerprintEnabled: false,
    identityRef: null,
  };
  const identity: FingerprintIdentity = {
    id: "00000000-0000-4000-8000-000000000001",
    formatVersion: FINGERPRINT_FORMAT_VERSION,
    config: { navigator: { platform: "Windows", languages: ["en-US"] } },
    createdAt: "2026-09-24T10:00:00.000Z",
  };

  try {
    await runMigrations(database);
    const profiles = new SqliteProfileRepository(database);
    const identities = new SqliteFingerprintIdentityRepository(database);
    await profiles.create(disabledProfile);

    await expect(
      profiles.enableFingerprintWithIdentity(
        disabledProfile.id,
        identity,
        "2026-09-24T10:00:00.000Z",
      ),
    ).resolves.toEqual({
      ...disabledProfile,
      fingerprintEnabled: true,
      identityRef: identity.id,
      updatedAt: "2026-09-24T10:00:00.000Z",
    });
    await expect(identities.findById(identity.id)).resolves.toEqual(identity);

    const missingIdentity: FingerprintIdentity = {
      ...identity,
      id: "00000000-0000-4000-8000-000000000002",
    };
    await expect(
      profiles.enableFingerprintWithIdentity(
        "missing-profile",
        missingIdentity,
        identity.createdAt,
      ),
    ).resolves.toBeNull();
    await expect(identities.findById(missingIdentity.id)).resolves.toBeNull();

    const collisionProfile = {
      ...disabledProfile,
      id: "profile-collision",
      profileCode: "profile-002",
    };
    const existingIdentity: FingerprintIdentity = {
      ...identity,
      id: "00000000-0000-4000-8000-000000000003",
    };
    await profiles.create(collisionProfile);
    await identities.create(existingIdentity);
    await expect(
      profiles.enableFingerprintWithIdentity(
        collisionProfile.id,
        existingIdentity,
        "2026-09-25T10:00:00.000Z",
      ),
    ).rejects.toThrow();
    await expect(profiles.findById(collisionProfile.id)).resolves.toEqual(
      collisionProfile,
    );
    await expect(identities.findById(existingIdentity.id)).resolves.toEqual(
      existingIdentity,
    );
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("atomically replaces a fingerprint identity and keeps the old identity immutable", async () => {
  const tempRoot = await fs.mkdtemp(
    join(tmpdir(), "antidetect-profile-fingerprint-replace-"),
  );
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);
  const previousIdentity: FingerprintIdentity = {
    id: "00000000-0000-4000-8000-000000000004",
    formatVersion: FINGERPRINT_FORMAT_VERSION,
    config: { navigator: { platform: "Windows", languages: ["en-US"] } },
    createdAt: "2026-09-24T10:00:00.000Z",
  };
  const nextIdentity: FingerprintIdentity = {
    ...previousIdentity,
    id: "00000000-0000-4000-8000-000000000005",
    config: { navigator: { platform: "Linux", languages: ["en-GB"] } },
    createdAt: "2026-09-25T10:00:00.000Z",
  };
  const profileWithPreviousIdentity = {
    ...profile,
    fingerprintEnabled: false,
    identityRef: previousIdentity.id,
  };

  try {
    await runMigrations(database);
    const profiles = new SqliteProfileRepository(database);
    const identities = new SqliteFingerprintIdentityRepository(database);
    await profiles.create(profileWithPreviousIdentity);
    await identities.create(previousIdentity);

    await expect(
      profiles.replaceFingerprintIdentity(
        profile.id,
        nextIdentity,
        nextIdentity.createdAt,
        "macOS",
      ),
    ).resolves.toEqual({
      ...profileWithPreviousIdentity,
      fingerprintPlatform: "macOS",
      identityRef: nextIdentity.id,
      updatedAt: nextIdentity.createdAt,
    });
    await expect(identities.findById(previousIdentity.id)).resolves.toEqual(
      previousIdentity,
    );
    await expect(identities.findById(nextIdentity.id)).resolves.toEqual(nextIdentity);

    await expect(
      profiles.replaceFingerprintIdentity(
        profile.id,
        previousIdentity,
        "2026-09-26T10:00:00.000Z",
      ),
    ).rejects.toThrow();
    await expect(profiles.findById(profile.id)).resolves.toEqual({
      ...profileWithPreviousIdentity,
      fingerprintPlatform: "macOS",
      identityRef: nextIdentity.id,
      updatedAt: nextIdentity.createdAt,
    });

    const missingIdentity: FingerprintIdentity = {
      ...nextIdentity,
      id: "00000000-0000-4000-8000-000000000006",
    };
    await expect(
      profiles.replaceFingerprintIdentity(
        "missing-profile",
        missingIdentity,
        nextIdentity.createdAt,
      ),
    ).resolves.toBeNull();
    await expect(identities.findById(missingIdentity.id)).resolves.toBeNull();
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("updates a disabled profile platform without keeping a mismatched identity reference", async () => {
  const tempRoot = await fs.mkdtemp(
    join(tmpdir(), "antidetect-profile-platform-disabled-"),
  );
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);
  const previousIdentity: FingerprintIdentity = {
    id: "00000000-0000-4000-8000-000000000007",
    formatVersion: FINGERPRINT_FORMAT_VERSION,
    config: { navigator: { platform: "Windows", languages: ["en-US"] } },
    createdAt: "2026-09-24T10:00:00.000Z",
  };

  try {
    await runMigrations(database);
    const profiles = new SqliteProfileRepository(database);
    const identities = new SqliteFingerprintIdentityRepository(database);
    await profiles.create({ ...profile, identityRef: previousIdentity.id });
    await identities.create(previousIdentity);

    await expect(
      profiles.updateFingerprintSettings(profile.id, {
        fingerprintEnabled: false,
        identityRef: null,
        fingerprintPlatform: "Linux",
        updatedAt: "2026-10-17T10:00:00.000Z",
      }),
    ).resolves.toEqual({
      ...profile,
      fingerprintPlatform: "Linux",
      fingerprintEnabled: false,
      identityRef: null,
      updatedAt: "2026-10-17T10:00:00.000Z",
    });
    await expect(identities.findById(previousIdentity.id)).resolves.toEqual(
      previousIdentity,
    );
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("allocates stable sequential profile codes", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-profile-code-"));
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);

  try {
    await runMigrations(database);
    const repository = new SqliteProfileRepository(database);
    const first = await repository.create({ ...profile, id: "profile-code-1" });
    const second = await repository.create({ ...profile, id: "profile-code-2" });

    expect(first.profileCode).toBe("profile-001");
    expect(second.profileCode).toBe("profile-002");
    await expect(repository.findById(second.id)).resolves.toMatchObject({
      profileCode: "profile-002",
    });
  } finally {
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("filters by display name and applies an allowlisted sort", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-profile-query-"));
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);

  try {
    await runMigrations(database);
    const repository = new SqliteProfileRepository(database);
    await repository.create({
      ...profile,
      id: "profile-001",
      displayName: "Alpha",
    });
    await repository.create({
      ...profile,
      id: "profile-002",
      displayName: "Beta",
    });
    await repository.create({
      ...profile,
      id: "profile-003",
      displayName: "Zeta",
    });

    await expect(
      repository.list({
        limit: 10,
        offset: 0,
        search: "et",
        sortBy: "displayName",
        sortOrder: "desc",
      }),
    ).resolves.toMatchObject([{ displayName: "Zeta" }, { displayName: "Beta" }]);
  } finally {
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("filters Cyrillic display names without case sensitivity", async () => {
  const tempRoot = await fs.mkdtemp(
    join(tmpdir(), "antidetect-profile-unicode-query-"),
  );
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);

  try {
    await runMigrations(database);
    const repository = new SqliteProfileRepository(database);
    await repository.create({
      ...profile,
      id: "profile-cyrillic",
      displayName: "Рабочий профиль",
    });

    await expect(
      repository.list({
        limit: 10,
        offset: 0,
        search: "ПРОФИЛЬ",
        sortBy: "displayName",
        sortOrder: "asc",
      }),
    ).resolves.toMatchObject([{ displayName: "Рабочий профиль" }]);
  } finally {
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
