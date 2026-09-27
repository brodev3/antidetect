import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { BrowserLifecycleService } from "../src/application/browserRuns/browser.lifecycle.service.ts";
import type {
  BrowserRun,
  BrowserRunRepository,
} from "../src/application/browserRuns/browser.run.repository.ts";
import type {
  BrowserRuntime,
  RuntimeRecoveryResult,
} from "../src/application/runtime/browser.runtime.ts";
import { ProfileOperationMutex } from "../src/application/lifecycle/profile.operation.mutex.ts";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { ensureAppRootDirectories } from "../src/infrastructure/filesystem/app.directories.ts";
import {
  FakeBrowserProcessHost,
  FakeBrowserRuntime,
} from "../src/infrastructure/runtime/fake.browser.runtime.ts";
import { createAppDatabase } from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";
import { SqliteBrowserRunRepository } from "../src/infrastructure/sqlite/sqlite.browser.run.repository.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";

const profile = {
  id: "profile-001",
  displayName: "Recovery test profile",
  fingerprintEnabled: true,
  identityRef: "identity-001",
  createdAt: "2026-09-27T10:00:00.000Z",
  updatedAt: "2026-09-27T10:00:00.000Z",
} as const;

class FailOnceSaveBrowserRunRepository implements BrowserRunRepository {
  private failNextSave = true;

  constructor(private readonly inner: BrowserRunRepository) {}

  create(run: BrowserRun): Promise<BrowserRun> {
    return this.inner.create(run);
  }

  findById(id: string): Promise<BrowserRun | null> {
    return this.inner.findById(id);
  }

  findActiveByProfileId(profileId: string): Promise<BrowserRun | null> {
    return this.inner.findActiveByProfileId(profileId);
  }

  findLatestByProfileId(profileId: string): Promise<BrowserRun | null> {
    return this.inner.findLatestByProfileId(profileId);
  }

  listOccupying(): Promise<readonly BrowserRun[]> {
    return this.inner.listOccupying();
  }

  async save(run: BrowserRun): Promise<BrowserRun> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("Simulated process metadata persistence failure");
    }
    return this.inner.save(run);
  }
}

test("recovers a spawned process from SQLite when process metadata was not saved", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-lifecycle-sqlite-"));
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const owner = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(owner);

  try {
    await runMigrations(database);
    const profiles = new SqliteProfileRepository(database);
    await profiles.create(profile);
    const runs = new SqliteBrowserRunRepository(database);
    const processHost = new FakeBrowserProcessHost();
    const firstRuntime = new FakeBrowserRuntime({ processHost });

    const createService = (
      runtime: FakeBrowserRuntime,
      runRepository: BrowserRunRepository,
    ): BrowserLifecycleService =>
      new BrowserLifecycleService(
        profiles,
        runRepository,
        runtime,
        new ProfileOperationMutex(),
        {
          profileDirectoryFor: (profileId) => `C:/profiles/${profileId}`,
          now: () => "2026-09-27T10:01:00.000Z",
          createRunId: () => "run-001",
        },
      );

    const firstService = createService(
      firstRuntime,
      new FailOnceSaveBrowserRunRepository(runs),
    );
    await expect(firstService.start(profile.id)).resolves.toMatchObject({
      id: "run-001",
      status: "starting",
    });
    await vi.waitFor(() => expect(firstService.pendingTaskCount).toBe(0));

    await expect(runs.findById("run-001")).resolves.toMatchObject({
      status: "starting",
      processPid: null,
      processIdentity: null,
    });
    expect(firstRuntime.activeProcesses()).toHaveLength(1);

    processHost.simulateApiProcessExit();
    const recoveryRuntime = new FakeBrowserRuntime({ processHost });
    const recoveryService = createService(recoveryRuntime, runs);

    await expect(recoveryService.recoverPersistedRuns()).resolves.toMatchObject([
      {
        id: "run-001",
        status: "running",
        processPid: 10_000,
        processIdentity: "profile-001:run-001:fake-process-001",
        failureCode: null,
      },
    ]);
    expect(recoveryRuntime.recoveryCalls).toEqual([
      {
        runId: "run-001",
        profileId: profile.id,
        processPid: null,
        processIdentity: null,
      },
    ]);
    await expect(recoveryService.start(profile.id)).rejects.toMatchObject({
      code: "ACTIVE_BROWSER_RUN_CONFLICT",
    });
    expect(recoveryRuntime.launchCalls).toEqual([]);
    await expect(runs.findById("run-001")).resolves.toMatchObject({
      status: "running",
      processPid: 10_000,
      processIdentity: "profile-001:run-001:fake-process-001",
    });
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("keeps uncertain SQLite runs occupied but releases confirmed absent runs", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-recovery-outcomes-"));
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

    for (const outcome of ["unknown", "timeout", "absent"] as const) {
      const currentProfile = {
        ...profile,
        id: `profile-${outcome}`,
        displayName: `Recovery ${outcome} profile`,
      };
      const runId = `run-${outcome}`;
      await profiles.create(currentProfile);
      await runs.create({
        id: runId,
        profileId: currentProfile.id,
        status: "starting",
        processPid: null,
        processIdentity: null,
        failureCode: null,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        endedAt: null,
      });

      const fakeRuntime = new FakeBrowserRuntime(
        outcome === "unknown"
          ? { recoveryPlans: [{ outcome: "unknown" }] }
          : outcome === "absent"
            ? { recoveryPlans: [{ outcome: "absent" }] }
            : {},
      );
      const runtime: BrowserRuntime =
        outcome === "timeout"
          ? {
              launch: (input) => fakeRuntime.launch(input),
              recover: (): Promise<RuntimeRecoveryResult> =>
                new Promise<RuntimeRecoveryResult>(() => {}),
              stop: (process, options) => fakeRuntime.stop(process, options),
            }
          : fakeRuntime;
      const service = new BrowserLifecycleService(
        profiles,
        runs,
        runtime,
        new ProfileOperationMutex(),
        {
          profileDirectoryFor: (profileId) => `C:/profiles/${profileId}`,
          now: () => "2026-09-27T10:02:00.000Z",
          createRunId: () => `retry-${outcome}`,
          recoveryTimeoutMs: 20,
        },
      );

      const [recoveredRun] = await service.recoverPersistedRuns();
      const expectedFailureCode =
        outcome === "unknown"
          ? "RUNTIME_PROCESS_IDENTITY_UNVERIFIED"
          : outcome === "timeout"
            ? "RUNTIME_RECOVERY_TIMEOUT"
            : "RUNTIME_PROCESS_NOT_FOUND_DURING_RECOVERY";
      expect(recoveredRun).toMatchObject({
        id: runId,
        status: outcome === "absent" ? "failed" : "recovery_required",
        failureCode: expectedFailureCode,
      });

      if (outcome === "absent") {
        await expect(runs.findActiveByProfileId(currentProfile.id)).resolves.toBeNull();
        await expect(service.start(currentProfile.id)).resolves.toMatchObject({
          id: `retry-${outcome}`,
          status: "starting",
        });
        await vi.waitFor(() => expect(service.pendingTaskCount).toBe(0));
        expect(fakeRuntime.launchCalls).toHaveLength(1);
        await expect(
          runs.findLatestByProfileId(currentProfile.id),
        ).resolves.toMatchObject({
          id: `retry-${outcome}`,
          status: "running",
        });
      } else {
        await expect(
          runs.findActiveByProfileId(currentProfile.id),
        ).resolves.toMatchObject({
          id: runId,
          status: "recovery_required",
        });
        await expect(service.start(currentProfile.id)).rejects.toMatchObject({
          code: "ACTIVE_BROWSER_RUN_CONFLICT",
        });
        expect(fakeRuntime.launchCalls).toEqual([]);
      }
    }
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
