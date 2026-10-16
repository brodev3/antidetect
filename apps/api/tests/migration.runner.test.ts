import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { expect, test } from "vitest";
import {
  createAppDatabase,
  type AppDatabase,
} from "../src/infrastructure/sqlite/app.database.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";
import { createProfilesMigration } from "../src/infrastructure/sqlite/migrations/001-create-profiles.ts";
import { createBrowserRunsMigration } from "../src/infrastructure/sqlite/migrations/002-create-browser-runs.ts";
import { addProfileCodesMigration } from "../src/infrastructure/sqlite/migrations/003-add-profile-codes.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";

const timestamp = "2026-09-19T10:00:00.000Z";
const profile = {
  id: "existing-profile",
  displayName: "Existing profile",
  identityRef: "test-identity",
  createdAt: timestamp,
  updatedAt: timestamp,
} as const;

const migratedProfile = {
  ...profile,
  profileCode: "profile-001",
  fingerprintPlatform: "Windows",
  fingerprintEnabled: true,
} as const;

async function withDatabase(
  callback: (database: AppDatabase) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), "antidetect-migration-test-"));
  const owner = acquireRootOwnership(join(root, "antidetect.sqlite"));
  const database = createAppDatabase(owner);
  try {
    await callback(database);
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function createMigrationHistory(database: AppDatabase): Promise<void> {
  await sql`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `.execute(database);
}

async function prepareVersionOne(database: AppDatabase): Promise<void> {
  await createMigrationHistory(database);
  await createProfilesMigration.up(database);
  await database
    .insertInto("schema_migrations")
    .values({
      version: createProfilesMigration.version,
      name: createProfilesMigration.name,
      applied_at: timestamp,
    })
    .execute();
  await sql`
    INSERT INTO profiles (id, display_name, identity_ref, created_at, updated_at)
    VALUES (${profile.id}, ${profile.displayName}, ${profile.identityRef}, ${profile.createdAt}, ${profile.updatedAt})
  `.execute(database);
}

async function prepareVersionThree(database: AppDatabase): Promise<void> {
  await prepareVersionOne(database);
  for (const migration of [createBrowserRunsMigration, addProfileCodesMigration]) {
    await migration.up(database);
    await database
      .insertInto("schema_migrations")
      .values({
        version: migration.version,
        name: migration.name,
        applied_at: timestamp,
      })
      .execute();
  }
}

test("applies pending migrations without losing profiles", async () => {
  await withDatabase(async (database) => {
    await prepareVersionOne(database);
    await runMigrations(database);
    await runMigrations(database);

    const applied = await database
      .selectFrom("schema_migrations")
      .select("version")
      .orderBy("version")
      .execute();
    expect(applied).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
    ]);
    await expect(
      new SqliteProfileRepository(database).findById(profile.id),
    ).resolves.toEqual(migratedProfile);
    await expect(
      database.selectFrom("browser_runs").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      database.selectFrom("fingerprint_identities").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});

test("upgrades version three without changing profiles, runs or code sequence", async () => {
  await withDatabase(async (database) => {
    await prepareVersionThree(database);
    await database
      .insertInto("browser_runs")
      .values({
        id: "existing-run",
        profile_id: profile.id,
        status: "recovery_required",
        process_pid: 42,
        process_identity: "saved-process-identity",
        failure_code: "RUNTIME_TIMEOUT",
        created_at: timestamp,
        updated_at: timestamp,
        ended_at: null,
      })
      .execute();
    const beforeProfiles = await database.selectFrom("profiles").selectAll().execute();
    const beforeRuns = await database.selectFrom("browser_runs").selectAll().execute();
    const beforeSequence = await database
      .selectFrom("profile_code_sequence")
      .selectAll()
      .execute();
    const beforeHistory = await database
      .selectFrom("schema_migrations")
      .selectAll()
      .execute();

    await runMigrations(database);
    await runMigrations(database);

    await expect(
      database.selectFrom("profiles").selectAll().execute(),
    ).resolves.toEqual(
      beforeProfiles.map((profile) => ({
        ...profile,
        fingerprint_platform: "Windows",
      })),
    );
    await expect(
      database.selectFrom("browser_runs").selectAll().execute(),
    ).resolves.toEqual(beforeRuns);
    await expect(
      database.selectFrom("profile_code_sequence").selectAll().execute(),
    ).resolves.toEqual(beforeSequence);
    await expect(
      database
        .selectFrom("schema_migrations")
        .selectAll()
        .where("version", "<=", 3)
        .execute(),
    ).resolves.toEqual(beforeHistory);
    await expect(
      database.selectFrom("fingerprint_identities").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});

test("rolls back fingerprint and platform schema when version four cannot be recorded", async () => {
  await withDatabase(async (database) => {
    await prepareVersionThree(database);
    const beforeHistory = await database
      .selectFrom("schema_migrations")
      .selectAll()
      .execute();
    const beforeProfiles = await database.selectFrom("profiles").selectAll().execute();
    await sql`
      CREATE TRIGGER fail_fingerprint_migration BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 4
      BEGIN
        SELECT RAISE(ABORT, 'injected fingerprint migration failure');
      END
    `.execute(database);

    await expect(runMigrations(database)).rejects.toThrow(
      "injected fingerprint migration failure",
    );
    await expect(
      sql`
      SELECT name FROM sqlite_schema WHERE name IN (
        'fingerprint_identities',
        'fingerprint_identities_no_update',
        'fingerprint_identities_no_replace'
      )
    `.execute(database),
    ).resolves.toMatchObject({ rows: [] });
    const profileColumns = await sql<{
      name: string;
    }>`PRAGMA table_info(profiles)`.execute(database);
    expect(profileColumns.rows.map((column) => column.name)).not.toContain(
      "fingerprint_platform",
    );
    await expect(
      database.selectFrom("schema_migrations").selectAll().execute(),
    ).resolves.toEqual(beforeHistory);
    await expect(
      database.selectFrom("profiles").selectAll().execute(),
    ).resolves.toEqual(beforeProfiles);

    await sql`DROP TRIGGER fail_fingerprint_migration`.execute(database);
    await expect(runMigrations(database)).resolves.toBeUndefined();
    await expect(
      database.selectFrom("fingerprint_identities").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});

test("supports profiles without fingerprints and rejects inconsistent settings", async () => {
  await withDatabase(async (database) => {
    await runMigrations(database);
    await sql`
      INSERT INTO profiles (
        id, display_name, identity_ref, fingerprint_enabled, created_at, updated_at
      ) VALUES (
        'no-fingerprint-profile', 'No fingerprint', NULL, 0, ${timestamp}, ${timestamp}
      )
    `.execute(database);

    await expect(
      sql`
        SELECT identity_ref, fingerprint_enabled
        FROM profiles
        WHERE id = 'no-fingerprint-profile'
      `.execute(database),
    ).resolves.toMatchObject({
      rows: [{ identity_ref: null, fingerprint_enabled: 0 }],
    });

    await expect(
      sql`
        INSERT INTO profiles (
          id, display_name, identity_ref, fingerprint_enabled, created_at, updated_at
        ) VALUES (
          'missing-identity-profile', 'Missing identity', NULL, 1, ${timestamp}, ${timestamp}
        )
      `.execute(database),
    ).rejects.toThrow();
    await expect(
      sql`
        INSERT INTO profiles (
          id, display_name, identity_ref, fingerprint_enabled, created_at, updated_at
        ) VALUES (
          'invalid-fingerprint-state', 'Invalid state', 'test-identity', 2, ${timestamp}, ${timestamp}
        )
      `.execute(database),
    ).rejects.toThrow();
  });
});

test("rejects a newer schema before applying pending migrations", async () => {
  await withDatabase(async (database) => {
    await prepareVersionOne(database);
    await database
      .insertInto("schema_migrations")
      .values({ version: 999, name: "future_schema", applied_at: timestamp })
      .execute();
    const before = await database.selectFrom("schema_migrations").selectAll().execute();

    await expect(runMigrations(database)).rejects.toMatchObject({
      code: "INCOMPATIBLE_DATABASE_SCHEMA",
    });
    await expect(
      database.selectFrom("schema_migrations").selectAll().execute(),
    ).resolves.toEqual(before);
    await expect(
      sql`SELECT id, display_name AS displayName, identity_ref AS identityRef, created_at AS createdAt, updated_at AS updatedAt FROM profiles WHERE id = ${profile.id}`.execute(
        database,
      ),
    ).resolves.toMatchObject({ rows: [profile] });
    const tables =
      await sql`SELECT name FROM sqlite_schema WHERE name = 'browser_runs'`.execute(
        database,
      );
    expect(tables.rows).toEqual([]);
  });
});

test.each([
  {
    label: "previous initial schema",
    version: 1,
    name: "create_profiles",
  },
  { label: "renamed", version: 1, name: "unexpected_name" },
  { label: "incomplete", version: 2, name: "create_browser_runs" },
])(
  "rejects $label history before creating product tables",
  async ({ version, name }) => {
    await withDatabase(async (database) => {
      await createMigrationHistory(database);
      await database
        .insertInto("schema_migrations")
        .values({ version, name, applied_at: timestamp })
        .execute();

      await expect(runMigrations(database)).rejects.toMatchObject({
        code: "INCOMPATIBLE_DATABASE_SCHEMA",
      });
      const tables =
        await sql`SELECT name FROM sqlite_schema WHERE name IN ('profiles', 'browser_runs')`.execute(
          database,
        );
      expect(tables.rows).toEqual([]);
      await expect(
        database.selectFrom("schema_migrations").selectAll().execute(),
      ).resolves.toEqual([{ version, name, applied_at: timestamp }]);
    });
  },
);

test("rolls back schema changes when recording a migration fails and allows retry", async () => {
  await withDatabase(async (database) => {
    await prepareVersionOne(database);
    await sql`
      CREATE TRIGGER fail_migration_record BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 2
      BEGIN
        SELECT RAISE(ABORT, 'injected migration record failure');
      END
    `.execute(database);

    await expect(runMigrations(database)).rejects.toThrow(
      "injected migration record failure",
    );
    const objects = await sql`
      SELECT name FROM sqlite_schema
      WHERE name IN ('browser_runs', 'browser_runs_one_active_per_profile')
    `.execute(database);
    expect(objects.rows).toEqual([]);
    await expect(
      database.selectFrom("schema_migrations").select("version").execute(),
    ).resolves.toEqual([{ version: 1 }]);
    await expect(
      sql`SELECT id, display_name AS displayName, identity_ref AS identityRef, created_at AS createdAt, updated_at AS updatedAt FROM profiles WHERE id = ${profile.id}`.execute(
        database,
      ),
    ).resolves.toMatchObject({ rows: [profile] });

    await sql`DROP TRIGGER fail_migration_record`.execute(database);
    await expect(runMigrations(database)).resolves.toBeUndefined();
    await expect(
      database.selectFrom("browser_runs").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});
