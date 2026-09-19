import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { expect, test } from "vitest";
import {
  BrowserRunRecoveryBarrier,
  RecoveryBarrierBlockedError,
} from "../src/application/browserRuns/browser.run.recovery.ts";
import type { BrowserRun } from "../src/application/browserRuns/browser.run.repository.ts";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { ensureAppRootDirectories } from "../src/infrastructure/filesystem/app.directories.ts";
import { createAppDatabase } from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { SqliteBrowserRunRepository } from "../src/infrastructure/sqlite/sqlite.browser.run.repository.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";

const timestamp = "2026-09-19T10:00:00.000Z";

function browserRun(
  id: string,
  profileId: string,
  status: BrowserRun["status"],
): BrowserRun {
  return {
    id,
    profileId,
    status,
    processPid: null,
    processIdentity: null,
    failureCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    endedAt: status === "stopped" || status === "failed" ? timestamp : null,
  };
}

async function withBarrier<T>(
  callback: (
    profiles: SqliteProfileRepository,
    runs: SqliteBrowserRunRepository,
    barrier: BrowserRunRecoveryBarrier,
  ) => Promise<T>,
): Promise<T> {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-recovery-barrier-"));
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);

  try {
    await runMigrations(database);
    const profiles = new SqliteProfileRepository(database);
    const runs = new SqliteBrowserRunRepository(database);
    const barrier = new BrowserRunRecoveryBarrier(runs);
    return await callback(profiles, runs, barrier);
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test("allows readiness when only terminal history is persisted", async () => {
  await withBarrier(async (profiles, runs, barrier) => {
    await profiles.create({
      id: "profile-001",
      displayName: "History profile",
      identityRef: "identity-001",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await runs.create(browserRun("run-stopped", "profile-001", "stopped"));
    await runs.create(browserRun("run-failed", "profile-001", "failed"));

    await expect(barrier.inspect()).resolves.toEqual({
      status: "ready",
      blockingRuns: [],
    });
  });
});

test("blocks readiness for every occupying status", async () => {
  await withBarrier(async (profiles, runs, barrier) => {
    const statuses = ["starting", "running", "stopping", "recovery_required"] as const;

    for (const [index, status] of statuses.entries()) {
      const profileId = `profile-00${index + 1}`;
      await profiles.create({
        id: profileId,
        displayName: `${status} profile`,
        identityRef: `identity-00${index + 1}`,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await runs.create(browserRun(`run-${index + 1}`, profileId, status));
    }

    const result = await barrier.inspect();

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.blockingRuns.map((run) => [run.id, run.status])).toEqual([
        ["run-1", "starting"],
        ["run-2", "running"],
        ["run-3", "stopping"],
        ["run-4", "recovery_required"],
      ]);
      expect(result.blockingRuns.every((run) => run.processPid === null)).toBe(true);
      expect(result.blockingRuns.every((run) => run.processIdentity === null)).toBe(
        true,
      );
      for (const run of result.blockingRuns) {
        await expect(runs.findById(run.id)).resolves.toMatchObject({
          status: run.status,
        });
      }
      expect(() => barrier.assertReady(result)).toThrow(
        new RecoveryBarrierBlockedError(result.blockingRuns),
      );
    }
  });
});

test("includes only allowlisted run fields in recovery errors", () => {
  const run = {
    ...browserRun("run-diagnostic", "profile-diagnostic", "starting"),
    processPid: 424242,
    processIdentity: "PRIVATE_PROCESS_METADATA_TEST_MARKER",
    failureCode: "PRIVATE_FAILURE_DETAILS_TEST_MARKER",
  };
  const error = new RecoveryBarrierBlockedError([run]);

  expect(error.blockingRuns).toEqual([
    { id: run.id, profileId: run.profileId, status: run.status },
  ]);
  expect(error.message).toContain(run.id);
  for (const output of [inspect(error), JSON.stringify(error)]) {
    expect(output).not.toContain(run.processIdentity);
    expect(output).not.toContain(run.failureCode);
    expect(output).not.toContain("processPid");
  }
});
