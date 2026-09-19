import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { BrowserRunService } from "../src/application/browserRuns/browser.run.service.ts";
import { ProfileOperationMutex } from "../src/application/lifecycle/profile.operation.mutex.ts";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { ensureAppRootDirectories } from "../src/infrastructure/filesystem/app.directories.ts";
import { createAppDatabase } from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { SqliteBrowserRunRepository } from "../src/infrastructure/sqlite/sqlite.browser.run.repository.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";

const firstProfile = {
  id: "profile-001",
  displayName: "Research profile",
  identityRef: "identity-001",
  createdAt: "2026-09-18T10:00:00.000Z",
  updatedAt: "2026-09-18T10:00:00.000Z",
} as const;

const secondProfile = {
  ...firstProfile,
  id: "profile-002",
  displayName: "Testing profile",
  identityRef: "identity-002",
} as const;

async function withService<T>(
  callback: (service: BrowserRunService) => Promise<T>,
): Promise<T> {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-browser-run-service-"));
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
    const runs = new SqliteBrowserRunRepository(database);
    const service = new BrowserRunService(profiles, runs, new ProfileOperationMutex(), {
      now: () => "2026-09-18T10:01:00.000Z",
      createRunId: (() => {
        let sequence = 0;
        return () => `run-${++sequence}`;
      })(),
    });

    return await callback(service);
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test("starts one run per profile and persists it", async () => {
  await withService(async (service) => {
    const run = await service.start(firstProfile.id);

    expect(run).toMatchObject({
      id: "run-1",
      profileId: firstProfile.id,
      status: "starting",
      createdAt: "2026-09-18T10:01:00.000Z",
      endedAt: null,
    });

    await expect(service.start(firstProfile.id)).rejects.toMatchObject({
      code: "ACTIVE_BROWSER_RUN_CONFLICT",
      activeRunId: "run-1",
    });

    await expect(service.start(secondProfile.id)).resolves.toMatchObject({
      profileId: secondProfile.id,
      status: "starting",
    });
  });
});

test("rejects an unknown profile", async () => {
  await withService(async (service) => {
    await expect(service.start("missing-profile")).rejects.toMatchObject({
      code: "PROFILE_NOT_FOUND",
    });
  });
});

test("persists lifecycle transitions and makes repeated stopped transitions idempotent", async () => {
  await withService(async (service) => {
    const starting = await service.start(firstProfile.id);
    const running = await service.transition(starting.id, "running");
    const stopping = await service.transition(starting.id, "stopping");
    const stopped = await service.transition(starting.id, "stopped");
    const repeatedStop = await service.transition(starting.id, "stopped");

    expect(running.status).toBe("running");
    expect(stopping.status).toBe("stopping");
    expect(stopped.status).toBe("stopped");
    expect(stopped.endedAt).toBe("2026-09-18T10:01:00.000Z");
    expect(repeatedStop).toEqual(stopped);
  });
});

test("serializes concurrent starts for the same profile", async () => {
  await withService(async (service) => {
    const results = await Promise.allSettled([
      service.start(firstProfile.id),
      service.start(firstProfile.id),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
