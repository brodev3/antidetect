import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { expect, test } from "vitest";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { ensureAppRootDirectories } from "../src/infrastructure/filesystem/app.directories.ts";
import { createAppDatabase } from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";

const profile = {
  id: "profile-001",
  displayName: "Research profile",
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

  try {
    await runMigrations(firstDatabase);
    await runMigrations(firstDatabase);

    const migrations = await firstDatabase
      .selectFrom("schema_migrations")
      .selectAll()
      .execute();
    expect(migrations).toHaveLength(2);
    expect(migrations.map((migration) => migration.name)).toEqual([
      "create_profiles",
      "create_browser_runs",
    ]);

    const repository = new SqliteProfileRepository(firstDatabase);
    await expect(repository.findById(profile.id)).resolves.toBeNull();
    await expect(repository.create(profile)).resolves.toEqual(profile);
    await expect(repository.findById(profile.id)).resolves.toEqual(profile);
    await expect(repository.list({ limit: 50, offset: 0 })).resolves.toEqual([profile]);
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
    ).resolves.toEqual(profile);
  } finally {
    secondOwner.close();
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
