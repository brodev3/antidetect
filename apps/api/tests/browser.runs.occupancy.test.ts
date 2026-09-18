import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { ensureAppRootDirectories } from "../src/infrastructure/filesystem/app.directories.ts";
import { createAppDatabase } from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";

const firstProfile = {
  id: "profile-001",
  displayName: "Research profile",
  identityRef: "identity-001",
  createdAt: "2026-09-17T10:00:00.000Z",
  updatedAt: "2026-09-17T10:00:00.000Z",
} as const;

const secondProfile = {
  ...firstProfile,
  id: "profile-002",
  displayName: "Testing profile",
  identityRef: "identity-002",
} as const;

function browserRun(
  id: string,
  profileId: string,
  status:
    "starting" | "running" | "stopping" | "recovery_required" | "stopped" | "failed",
) {
  return {
    id,
    profile_id: profileId,
    status,
    process_pid: null,
    process_identity: null,
    failure_code: null,
    created_at: "2026-09-17T10:00:00.000Z",
    updated_at: "2026-09-17T10:00:00.000Z",
    ended_at:
      status === "stopped" || status === "failed" ? "2026-09-17T10:01:00.000Z" : null,
  } as const;
}

test("allows one active run per profile and preserves terminal history", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-browser-runs-"));
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);

  try {
    await runMigrations(database);
    const profiles = new SqliteProfileRepository(database);
    await profiles.create(firstProfile);
    await profiles.create(secondProfile);

    await database
      .insertInto("browser_runs")
      .values(browserRun("run-001", firstProfile.id, "running"))
      .execute();

    await expect(
      database
        .insertInto("browser_runs")
        .values(browserRun("run-002", firstProfile.id, "starting"))
        .execute(),
    ).rejects.toThrow();

    await expect(
      database
        .insertInto("browser_runs")
        .values(browserRun("run-003", firstProfile.id, "recovery_required"))
        .execute(),
    ).rejects.toThrow();

    await expect(
      database
        .insertInto("browser_runs")
        .values(browserRun("run-004", secondProfile.id, "starting"))
        .execute(),
    ).resolves.toBeDefined();

    await expect(
      database
        .insertInto("browser_runs")
        .values(browserRun("run-005", firstProfile.id, "stopped"))
        .execute(),
    ).resolves.toBeDefined();

    await expect(
      database
        .insertInto("browser_runs")
        .values(browserRun("run-006", firstProfile.id, "failed"))
        .execute(),
    ).resolves.toBeDefined();
  } finally {
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejects a browser run for an unknown profile", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-browser-run-fk-"));
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);

  try {
    await runMigrations(database);

    await expect(
      database
        .insertInto("browser_runs")
        .values(browserRun("run-orphan", "missing-profile", "starting"))
        .execute(),
    ).rejects.toThrow();
  } finally {
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
