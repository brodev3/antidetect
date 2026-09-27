import { describe, expect, test, vi } from "vitest";
import { BrowserLifecycleService } from "../src/application/browserRuns/browser.lifecycle.service.ts";
import { ActiveBrowserRunConflictError } from "../src/application/browserRuns/browser.run.errors.ts";
import type {
  BrowserRun,
  BrowserRunRepository,
} from "../src/application/browserRuns/browser.run.repository.ts";
import {
  isBrowserRunOccupying,
  type BrowserRunStatus,
} from "../src/application/browserRuns/browser.run.state.ts";
import { ProfileOperationMutex } from "../src/application/lifecycle/profile.operation.mutex.ts";
import type {
  Profile,
  ProfileDraft,
  ProfileFingerprintSettings,
  ProfileListOptions,
  ProfileRepository,
} from "../src/application/profiles/profile.repository.ts";
import type {
  BrowserRuntime,
  RuntimeLaunchInput,
  RuntimeLaunchResult,
  RuntimeProcess,
  RuntimeRecoveryInput,
  RuntimeRecoveryResult,
  RuntimeStopOptions,
  RuntimeStopResult,
} from "../src/application/runtime/browser.runtime.ts";
import {
  FakeBrowserProcessHost,
  FakeBrowserRuntime,
} from "../src/infrastructure/runtime/fake.browser.runtime.ts";

const timestamp = "2026-09-22T10:00:00.000Z";

const firstProfile: Profile = {
  id: "profile-001",
  profileCode: "profile-001",
  displayName: "Research profile",
  fingerprintEnabled: true,
  identityRef: "identity-001",
  createdAt: timestamp,
  updatedAt: timestamp,
};

const secondProfile: Profile = {
  ...firstProfile,
  id: "profile-002",
  profileCode: "profile-002",
  displayName: "Testing profile",
  fingerprintEnabled: true,
  identityRef: "identity-002",
};

class MemoryProfileRepository implements ProfileRepository {
  private readonly profiles = new Map<string, Profile>();

  constructor(profiles: readonly Profile[] = [firstProfile, secondProfile]) {
    for (const profile of profiles) {
      this.profiles.set(profile.id, profile);
    }
  }

  async create(profile: ProfileDraft): Promise<Profile> {
    const created = {
      ...profile,
      profileCode: `profile-${String(this.profiles.size + 1).padStart(3, "0")}`,
    };
    this.profiles.set(created.id, created);
    return created;
  }

  async findById(id: string): Promise<Profile | null> {
    return this.profiles.get(id) ?? null;
  }

  async updateFingerprintSettings(
    id: string,
    settings: ProfileFingerprintSettings,
  ): Promise<Profile | null> {
    const profile = this.profiles.get(id);
    if (profile === undefined) return null;

    const updatedProfile = { ...profile, ...settings };
    this.profiles.set(id, updatedProfile);
    return updatedProfile;
  }

  async list(options: ProfileListOptions): Promise<readonly Profile[]> {
    void options;
    return [...this.profiles.values()];
  }
}

class MemoryBrowserRunRepository implements BrowserRunRepository {
  private readonly runs = new Map<string, BrowserRun>();
  failNextSave: Error | null = null;

  async create(run: BrowserRun): Promise<BrowserRun> {
    const active = await this.findActiveByProfileId(run.profileId);
    if (active !== null) {
      throw new Error(`Active run already exists: ${active.id}`);
    }
    this.runs.set(run.id, run);
    return run;
  }

  async findById(id: string): Promise<BrowserRun | null> {
    return this.runs.get(id) ?? null;
  }

  async findActiveByProfileId(profileId: string): Promise<BrowserRun | null> {
    return (
      [...this.runs.values()]
        .filter(
          (run) => run.profileId === profileId && isBrowserRunOccupying(run.status),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
    );
  }

  async findLatestByProfileId(profileId: string): Promise<BrowserRun | null> {
    return (
      [...this.runs.values()].filter((run) => run.profileId === profileId).at(-1) ??
      null
    );
  }

  async listOccupying(): Promise<readonly BrowserRun[]> {
    return [...this.runs.values()].filter((run) => isBrowserRunOccupying(run.status));
  }

  async save(run: BrowserRun): Promise<BrowserRun> {
    if (this.failNextSave !== null) {
      const error = this.failNextSave;
      this.failNextSave = null;
      throw error;
    }
    if (!this.runs.has(run.id)) {
      throw new Error(`Run not found: ${run.id}`);
    }
    this.runs.set(run.id, run);
    return run;
  }

  all(): readonly BrowserRun[] {
    return [...this.runs.values()];
  }
}

class DeferredLaunchRuntime implements BrowserRuntime {
  readonly inner = new FakeBrowserRuntime();
  private readonly launchGate: Promise<void>;
  private resolveLaunch!: () => void;
  private markLaunchStarted!: () => void;
  private readonly launchStarted: Promise<void>;

  constructor() {
    this.launchGate = new Promise<void>((resolve) => {
      this.resolveLaunch = resolve;
    });
    this.launchStarted = new Promise<void>((resolve) => {
      this.markLaunchStarted = resolve;
    });
  }

  get stopCalls(): readonly {
    readonly processId: string;
    readonly options: RuntimeStopOptions;
  }[] {
    return this.inner.stopCalls;
  }

  async launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
    this.markLaunchStarted();
    await this.launchGate;
    return this.inner.launch(input);
  }

  recover(input: RuntimeRecoveryInput): Promise<RuntimeRecoveryResult> {
    return this.inner.recover(input);
  }

  stop(
    process: RuntimeProcess,
    options: RuntimeStopOptions,
  ): Promise<RuntimeStopResult> {
    return this.inner.stop(process, options);
  }

  async waitUntilLaunchStarts(): Promise<void> {
    await this.launchStarted;
  }

  releaseLaunch(): void {
    this.resolveLaunch();
  }
}

class DeferredStopRuntime implements BrowserRuntime {
  readonly inner = new FakeBrowserRuntime();
  stopInvocations = 0;
  private readonly stopGate: Promise<void>;
  private resolveStop!: () => void;
  private markStopStarted!: () => void;
  private readonly stopStarted: Promise<void>;

  constructor() {
    this.stopGate = new Promise<void>((resolve) => {
      this.resolveStop = resolve;
    });
    this.stopStarted = new Promise<void>((resolve) => {
      this.markStopStarted = resolve;
    });
  }

  launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
    return this.inner.launch(input);
  }

  recover(input: RuntimeRecoveryInput): Promise<RuntimeRecoveryResult> {
    return this.inner.recover(input);
  }

  async stop(
    process: RuntimeProcess,
    options: RuntimeStopOptions,
  ): Promise<RuntimeStopResult> {
    this.stopInvocations += 1;
    this.markStopStarted();
    await this.stopGate;
    return this.inner.stop(process, options);
  }

  async waitUntilStopStarts(): Promise<void> {
    await this.stopStarted;
  }

  releaseStop(): void {
    this.resolveStop();
  }
}

class ThrowingCleanupRuntime implements BrowserRuntime {
  readonly inner = new FakeBrowserRuntime({
    launchPlans: [{ outcome: "fail-after-spawn", failureCode: "METADATA_UNKNOWN" }],
  });

  launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
    return this.inner.launch(input);
  }

  recover(input: RuntimeRecoveryInput): Promise<RuntimeRecoveryResult> {
    return this.inner.recover(input);
  }

  async stop(
    process: RuntimeProcess,
    options: RuntimeStopOptions,
  ): Promise<RuntimeStopResult> {
    void process;
    void options;
    throw new Error("Cleanup result is unknown");
  }
}

function createService(
  runtime: BrowserRuntime,
  profiles = new MemoryProfileRepository(),
  runs = new MemoryBrowserRunRepository(),
  timeouts: {
    readonly launchTimeoutMs?: number;
    readonly stopTimeoutMs?: number;
    readonly shutdownTimeoutMs?: number;
    readonly now?: () => string;
  } = {},
): {
  readonly service: BrowserLifecycleService;
  readonly profiles: MemoryProfileRepository;
  readonly runs: MemoryBrowserRunRepository;
} {
  let sequence = 0;
  return {
    profiles,
    runs,
    service: new BrowserLifecycleService(
      profiles,
      runs,
      runtime,
      new ProfileOperationMutex(),
      {
        profileDirectoryFor: (profileId) => `C:/profiles/${profileId}`,
        now: timeouts.now ?? (() => timestamp),
        createRunId: () => `run-${++sequence}`,
        createFingerprintIdentityRef: () => `test-identity:generated-${++sequence}`,
        launchTimeoutMs: timeouts.launchTimeoutMs ?? 5_000,
        stopTimeoutMs: timeouts.stopTimeoutMs ?? 5_000,
        shutdownTimeoutMs: timeouts.shutdownTimeoutMs ?? 5_000,
      },
    ),
  };
}

async function flushRuntimeEvents(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitForBackgroundTasks(service: BrowserLifecycleService): Promise<void> {
  await vi.waitFor(() => expect(service.pendingTaskCount).toBe(0));
}

describe("BrowserLifecycleService", () => {
  test("disables a fingerprint without discarding its identity", async () => {
    const updatedAt = "2026-09-23T10:00:00.000Z";
    const { service, profiles } = createService(
      new FakeBrowserRuntime(),
      new MemoryProfileRepository([firstProfile]),
      undefined,
      { now: () => updatedAt },
    );

    await expect(
      service.updateFingerprintMode(firstProfile.id, false),
    ).resolves.toEqual({
      ...firstProfile,
      fingerprintEnabled: false,
      updatedAt,
    });
    await expect(profiles.findById(firstProfile.id)).resolves.toMatchObject({
      identityRef: firstProfile.identityRef,
      fingerprintEnabled: false,
    });
  });

  test("re-enables a fingerprint using its existing identity", async () => {
    const profileWithoutFingerprint = {
      ...firstProfile,
      fingerprintEnabled: false,
    };
    const { service } = createService(
      new FakeBrowserRuntime(),
      new MemoryProfileRepository([profileWithoutFingerprint]),
    );

    await expect(
      service.updateFingerprintMode(firstProfile.id, true),
    ).resolves.toMatchObject({
      fingerprintEnabled: true,
      identityRef: firstProfile.identityRef,
    });
  });

  test("assigns a server-created identity when enabling a profile without one", async () => {
    const profileWithoutIdentity = {
      ...firstProfile,
      fingerprintEnabled: false,
      identityRef: null,
    };
    const { service } = createService(
      new FakeBrowserRuntime(),
      new MemoryProfileRepository([profileWithoutIdentity]),
    );

    await expect(
      service.updateFingerprintMode(firstProfile.id, true),
    ).resolves.toMatchObject({
      fingerprintEnabled: true,
      identityRef: "test-identity:generated-1",
    });
  });

  test.each(["starting", "running", "stopping", "recovery_required"] as const)(
    "rejects a fingerprint change while a %s run occupies the profile",
    async (status) => {
      const { service, profiles, runs } = createService(
        new FakeBrowserRuntime(),
        new MemoryProfileRepository([firstProfile]),
      );
      await runs.create({
        id: `run-${status}`,
        profileId: firstProfile.id,
        status,
        processPid: status === "starting" ? null : 4000,
        processIdentity: status === "starting" ? null : `identity-${status}`,
        failureCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        endedAt: null,
      });

      await expect(
        service.updateFingerprintMode(firstProfile.id, false),
      ).rejects.toBeInstanceOf(ActiveBrowserRunConflictError);
      await expect(profiles.findById(firstProfile.id)).resolves.toEqual(firstProfile);
    },
  );

  test("launches a profile and persists process identity", async () => {
    const runtime = new FakeBrowserRuntime({ firstPid: 4000 });
    const { service } = createService(runtime);

    await expect(service.start(firstProfile.id)).resolves.toMatchObject({
      id: "run-1",
      status: "starting",
    });
    await waitForBackgroundTasks(service);
    await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
      id: "run-1",
      status: "running",
      processPid: 4000,
      processIdentity: "profile-001:run-1:fake-process-001",
    });
    expect(runtime.launchCalls).toEqual([
      {
        runId: "run-1",
        profileId: firstProfile.id,
        profileDirectory: "C:/profiles/profile-001",
        identityRef: firstProfile.identityRef,
      },
    ]);
  });

  test("starts a profile without passing a fingerprint identity", async () => {
    const profileWithoutFingerprint: Profile = {
      ...firstProfile,
      id: "profile-no-fingerprint",
      profileCode: "profile-no-fingerprint",
      displayName: "Direct profile",
      fingerprintEnabled: false,
      identityRef: null,
    };
    const runtime = new FakeBrowserRuntime();
    const { service } = createService(
      runtime,
      new MemoryProfileRepository([profileWithoutFingerprint]),
    );

    await service.start(profileWithoutFingerprint.id);
    await waitForBackgroundTasks(service);

    expect(runtime.launchCalls).toMatchObject([{ identityRef: null }]);
  });

  test("quarantines a start that outlives shutdown and ignores its late result", async () => {
    const runtime = new DeferredLaunchRuntime();
    const { service, runs } = createService(runtime, undefined, undefined, {
      launchTimeoutMs: 200,
      shutdownTimeoutMs: 20,
    });

    await service.start(firstProfile.id);
    await runtime.waitUntilLaunchStarts();
    await service.prepareForShutdown();

    await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
      status: "recovery_required",
      failureCode: "RUNTIME_SHUTDOWN_TIMEOUT",
      processPid: null,
      processIdentity: null,
    });
    await expect(service.start(firstProfile.id)).rejects.toThrow(
      "Browser lifecycle is shutting down",
    );

    runtime.releaseLaunch();
    await waitForBackgroundTasks(service);
    expect(runs.all()).toMatchObject([
      {
        status: "recovery_required",
        failureCode: "RUNTIME_SHUTDOWN_TIMEOUT",
        processPid: null,
        processIdentity: null,
      },
    ]);
    expect(runtime.inner.activeProcesses()).toHaveLength(1);
    expect(runtime.inner.stopCalls).toEqual([]);
  });

  test("keeps an unresolved stop occupied without issuing another stop", async () => {
    const runtime = new DeferredStopRuntime();
    const { service, runs } = createService(runtime, undefined, undefined, {
      shutdownTimeoutMs: 20,
    });
    await service.start(firstProfile.id);
    await waitForBackgroundTasks(service);
    await service.stop(firstProfile.id);
    await runtime.waitUntilStopStarts();

    await service.prepareForShutdown();

    await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
      status: "recovery_required",
      failureCode: "RUNTIME_SHUTDOWN_TIMEOUT",
    });
    expect(runtime.stopInvocations).toBe(1);

    runtime.releaseStop();
    await waitForBackgroundTasks(service);
    expect(runs.all()).toMatchObject([
      { status: "recovery_required", failureCode: "RUNTIME_SHUTDOWN_TIMEOUT" },
    ]);
    expect(runtime.stopInvocations).toBe(1);
  });

  test("reattaches to the same process after an API restart and tracks its exit", async () => {
    const processHost = new FakeBrowserProcessHost();
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const firstRuntime = new FakeBrowserRuntime({ processHost, firstPid: 4100 });
    const first = createService(firstRuntime, profiles, runs);

    await first.service.start(firstProfile.id);
    await waitForBackgroundTasks(first.service);
    processHost.simulateApiProcessExit();

    const restartedRuntime = new FakeBrowserRuntime({ processHost });
    const restarted = createService(restartedRuntime, profiles, runs);
    await expect(restarted.service.recoverPersistedRuns()).resolves.toMatchObject([
      { id: "run-1", status: "running", processPid: 4100 },
    ]);
    expect(restartedRuntime.recoveryCalls).toEqual([
      {
        runId: "run-1",
        profileId: firstProfile.id,
        processPid: 4100,
        processIdentity: "profile-001:run-1:fake-process-001",
      },
    ]);

    const recoveredProcess = restartedRuntime.activeProcesses()[0];
    expect(recoveredProcess).toBeDefined();
    restartedRuntime.emitUnexpectedExit(recoveredProcess!);
    await vi.waitFor(async () => {
      expect(await restarted.service.getLatest(firstProfile.id)).toMatchObject({
        status: "failed",
        failureCode: "RUNTIME_UNEXPECTED_EXIT",
      });
    });
  });

  test("stops the reattached process after an API restart and releases occupancy", async () => {
    const processHost = new FakeBrowserProcessHost();
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const firstRuntime = new FakeBrowserRuntime({ processHost, firstPid: 4100 });
    const first = createService(firstRuntime, profiles, runs);

    await first.service.start(firstProfile.id);
    await waitForBackgroundTasks(first.service);
    const originalProcess = firstRuntime.activeProcesses()[0]!;
    processHost.simulateApiProcessExit();

    const restartedRuntime = new FakeBrowserRuntime({ processHost });
    const restarted = createService(restartedRuntime, profiles, runs);
    await expect(restarted.service.recoverPersistedRuns()).resolves.toMatchObject([
      { id: "run-1", status: "running", processPid: 4100 },
    ]);

    const recoveredProcess = restartedRuntime.activeProcesses()[0]!;
    expect(recoveredProcess.runtimeId).toBe(originalProcess.runtimeId);
    await expect(restarted.service.stop(firstProfile.id)).resolves.toMatchObject({
      accepted: true,
      run: { id: "run-1", status: "stopping" },
    });

    await waitForBackgroundTasks(restarted.service);

    expect(restartedRuntime.stopCalls).toEqual([
      { processId: recoveredProcess.runtimeId, options: { timeoutMs: 5_000 } },
    ]);
    await expect(restarted.service.getLatest(firstProfile.id)).resolves.toMatchObject({
      id: "run-1",
      status: "stopped",
      failureCode: null,
    });
    await expect(runs.findActiveByProfileId(firstProfile.id)).resolves.toBeNull();
    expect(restartedRuntime.activeProcesses()).toHaveLength(0);
  });

  test("keeps a reattached process occupied when its stop times out", async () => {
    const processHost = new FakeBrowserProcessHost();
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const firstRuntime = new FakeBrowserRuntime({ processHost, firstPid: 4100 });
    const first = createService(firstRuntime, profiles, runs);

    await first.service.start(firstProfile.id);
    await waitForBackgroundTasks(first.service);
    processHost.simulateApiProcessExit();

    const restartedRuntime = new FakeBrowserRuntime({
      processHost,
      stopPlans: [{ outcome: "timeout" }],
    });
    const restarted = createService(restartedRuntime, profiles, runs);
    await expect(restarted.service.recoverPersistedRuns()).resolves.toMatchObject([
      { id: "run-1", status: "running", processPid: 4100 },
    ]);

    await expect(restarted.service.stop(firstProfile.id)).resolves.toMatchObject({
      accepted: true,
      run: { id: "run-1", status: "stopping" },
    });
    await waitForBackgroundTasks(restarted.service);

    await expect(restarted.service.getLatest(firstProfile.id)).resolves.toMatchObject({
      id: "run-1",
      status: "recovery_required",
      failureCode: "RUNTIME_STOP_TIMEOUT",
    });
    await expect(runs.findActiveByProfileId(firstProfile.id)).resolves.toMatchObject({
      id: "run-1",
      status: "recovery_required",
    });
    expect(restartedRuntime.stopCalls).toHaveLength(1);
    expect(restartedRuntime.activeProcesses()).toHaveLength(1);
  });

  test("reattaches a starting run by run id when the API exits before saving PID metadata", async () => {
    const processHost = new FakeBrowserProcessHost();
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const startingRun: BrowserRun = {
      id: "run-1",
      profileId: firstProfile.id,
      status: "starting",
      processPid: null,
      processIdentity: null,
      failureCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
    };
    await runs.create(startingRun);

    const originalRuntime = new FakeBrowserRuntime({ processHost, firstPid: 4200 });
    await originalRuntime.launch({
      runId: startingRun.id,
      profileId: firstProfile.id,
      profileDirectory: `C:/profiles/${firstProfile.id}`,
      identityRef: firstProfile.identityRef,
    });
    processHost.simulateApiProcessExit();

    const restartedRuntime = new FakeBrowserRuntime({ processHost });
    const restarted = createService(restartedRuntime, profiles, runs);
    await expect(restarted.service.recoverPersistedRuns()).resolves.toMatchObject([
      {
        id: startingRun.id,
        status: "running",
        processPid: 4200,
        processIdentity: "profile-001:run-1:fake-process-001",
      },
    ]);
    expect(restartedRuntime.recoveryCalls).toEqual([
      {
        runId: startingRun.id,
        profileId: firstProfile.id,
        processPid: null,
        processIdentity: null,
      },
    ]);
  });

  test("releases a starting run only when the runtime confirms no process remains", async () => {
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const startingRun: BrowserRun = {
      id: "run-1",
      profileId: firstProfile.id,
      status: "starting",
      processPid: null,
      processIdentity: null,
      failureCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
    };
    await runs.create(startingRun);

    const runtime = new FakeBrowserRuntime({
      recoveryPlans: [{ outcome: "absent" }],
    });
    const { service } = createService(runtime, profiles, runs);
    await expect(service.recoverPersistedRuns()).resolves.toMatchObject([
      {
        id: startingRun.id,
        status: "failed",
        failureCode: "RUNTIME_PROCESS_NOT_FOUND_DURING_RECOVERY",
      },
    ]);
    await expect(runs.listOccupying()).resolves.toHaveLength(0);
  });

  test("keeps a starting run occupied when recovery cannot verify process state", async () => {
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const startingRun: BrowserRun = {
      id: "run-1",
      profileId: firstProfile.id,
      status: "starting",
      processPid: null,
      processIdentity: null,
      failureCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
    };
    await runs.create(startingRun);

    const runtime = new FakeBrowserRuntime({
      recoveryPlans: [{ outcome: "unknown" }],
    });
    const { service } = createService(runtime, profiles, runs);
    await expect(service.recoverPersistedRuns()).resolves.toMatchObject([
      {
        id: startingRun.id,
        status: "recovery_required",
        failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
      },
    ]);
    await expect(runs.listOccupying()).resolves.toHaveLength(1);
  });

  test("keeps an unverified process occupied instead of treating it as gone", async () => {
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const originalHost = new FakeBrowserProcessHost();
    const first = createService(
      new FakeBrowserRuntime({ processHost: originalHost }),
      profiles,
      runs,
    );
    await first.service.start(firstProfile.id);
    await waitForBackgroundTasks(first.service);

    const unconnectedRuntime = new FakeBrowserRuntime();
    const restarted = createService(unconnectedRuntime, profiles, runs);
    await expect(restarted.service.recoverPersistedRuns()).resolves.toMatchObject([
      {
        id: "run-1",
        status: "recovery_required",
        failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
      },
    ]);
    await expect(runs.listOccupying()).resolves.toHaveLength(1);
    expect(unconnectedRuntime.stopCalls).toEqual([]);
  });

  test("keeps a run occupied when reattachment returns a mismatched process identity", async () => {
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const processHost = new FakeBrowserProcessHost();
    const firstRuntime = new FakeBrowserRuntime({ processHost });
    const first = createService(firstRuntime, profiles, runs);
    await first.service.start(firstProfile.id);
    await waitForBackgroundTasks(first.service);
    const persistedRun = runs.all()[0]!;
    processHost.simulateApiProcessExit();

    const recoveryRuntime = new FakeBrowserRuntime({ processHost });
    const mismatchedRuntime: BrowserRuntime = {
      launch: (input) => recoveryRuntime.launch(input),
      recover: async (input) => {
        const result = await recoveryRuntime.recover(input);
        if (result.status !== "attached") return result;

        return {
          status: "attached",
          process: {
            ...result.process,
            processIdentity: "different-process-identity",
          },
        };
      },
      stop: (process, options) => recoveryRuntime.stop(process, options),
    };
    const restarted = createService(mismatchedRuntime, profiles, runs);

    await expect(restarted.service.recoverPersistedRuns()).resolves.toMatchObject([
      {
        id: "run-1",
        status: "recovery_required",
        failureCode: "RUNTIME_PROCESS_IDENTITY_MISMATCH",
      },
    ]);
    expect(recoveryRuntime.recoveryCalls).toEqual([
      {
        runId: persistedRun.id,
        profileId: persistedRun.profileId,
        processPid: persistedRun.processPid,
        processIdentity: persistedRun.processIdentity,
      },
    ]);
    await expect(runs.listOccupying()).resolves.toHaveLength(1);
    await expect(restarted.service.start(firstProfile.id)).rejects.toMatchObject({
      code: "ACTIVE_BROWSER_RUN_CONFLICT",
    });
    expect(recoveryRuntime.launchCalls).toEqual([]);
    expect(recoveryRuntime.stopCalls).toEqual([]);
    expect(recoveryRuntime.activeProcesses()).toHaveLength(1);
  });

  test("returns a recovery_required run to running after verified reattachment", async () => {
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const processHost = new FakeBrowserProcessHost();
    const first = createService(
      new FakeBrowserRuntime({ processHost }),
      profiles,
      runs,
    );
    await first.service.start(firstProfile.id);
    await waitForBackgroundTasks(first.service);
    processHost.simulateApiProcessExit();

    const unknown = createService(new FakeBrowserRuntime(), profiles, runs);
    await unknown.service.recoverPersistedRuns();
    await expect(unknown.service.getLatest(firstProfile.id)).resolves.toMatchObject({
      status: "recovery_required",
    });

    const verifiedRuntime = new FakeBrowserRuntime({ processHost });
    const verified = createService(verifiedRuntime, profiles, runs);
    await expect(verified.service.recoverPersistedRuns()).resolves.toMatchObject([
      { id: "run-1", status: "running", failureCode: null },
    ]);
    await expect(verified.service.start(firstProfile.id)).rejects.toMatchObject({
      code: "ACTIVE_BROWSER_RUN_CONFLICT",
    });
    expect(verifiedRuntime.launchCalls).toHaveLength(0);

    const recoveredProcess = verifiedRuntime.activeProcesses()[0];
    expect(recoveredProcess).toBeDefined();
    verifiedRuntime.emitUnexpectedExit(recoveredProcess!);
    await vi.waitFor(async () => {
      expect(await verified.service.getLatest(firstProfile.id)).toMatchObject({
        status: "failed",
        failureCode: "RUNTIME_UNEXPECTED_EXIT",
      });
    });
  });

  test("recovers by run id when process metadata persistence fails after spawn", async () => {
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const processHost = new FakeBrowserProcessHost();
    const firstRuntime = new FakeBrowserRuntime({ processHost });
    const first = createService(firstRuntime, profiles, runs);

    runs.failNextSave = new Error("Simulated process metadata persistence failure");
    await expect(first.service.start(firstProfile.id)).resolves.toMatchObject({
      id: "run-1",
      status: "starting",
    });
    await waitForBackgroundTasks(first.service);

    expect(runs.all()).toMatchObject([
      {
        id: "run-1",
        status: "starting",
        processPid: null,
        processIdentity: null,
      },
    ]);
    expect(firstRuntime.activeProcesses()).toHaveLength(1);

    processHost.simulateApiProcessExit();
    const restartedRuntime = new FakeBrowserRuntime({ processHost });
    const restarted = createService(restartedRuntime, profiles, runs);

    await expect(restarted.service.recoverPersistedRuns()).resolves.toMatchObject([
      {
        id: "run-1",
        status: "running",
        processPid: 10_000,
        processIdentity: "profile-001:run-1:fake-process-001",
        failureCode: null,
      },
    ]);
    expect(restartedRuntime.recoveryCalls).toEqual([
      {
        runId: "run-1",
        profileId: firstProfile.id,
        processPid: null,
        processIdentity: null,
      },
    ]);
    await expect(restarted.service.start(firstProfile.id)).rejects.toMatchObject({
      code: "ACTIVE_BROWSER_RUN_CONFLICT",
    });
    expect(restartedRuntime.launchCalls).toEqual([]);
    expect(restartedRuntime.activeProcesses()).toHaveLength(1);
  });

  test("marks a process failed when its owned exit is observed during API downtime", async () => {
    const profiles = new MemoryProfileRepository();
    const runs = new MemoryBrowserRunRepository();
    const processHost = new FakeBrowserProcessHost();
    const runtime = new FakeBrowserRuntime({ processHost });
    const first = createService(runtime, profiles, runs);
    await first.service.start(firstProfile.id);
    await waitForBackgroundTasks(first.service);

    const process = runtime.activeProcesses()[0];
    expect(process).toBeDefined();
    processHost.simulateApiProcessExit();
    runtime.emitUnexpectedExit(process!);

    const restarted = createService(
      new FakeBrowserRuntime({ processHost }),
      profiles,
      runs,
    );
    await expect(restarted.service.recoverPersistedRuns()).resolves.toMatchObject([
      {
        id: "run-1",
        status: "failed",
        failureCode: "RUNTIME_EXIT_DURING_RECOVERY",
      },
    ]);
    await expect(restarted.service.getLatest(firstProfile.id)).resolves.toMatchObject({
      status: "failed",
      failureCode: "RUNTIME_EXIT_DURING_RECOVERY",
    });
  });

  test("allows one start for a profile and does not globally block another profile", async () => {
    const runtime = new FakeBrowserRuntime();
    const { service } = createService(runtime);

    const sameProfile = await Promise.allSettled([
      service.start(firstProfile.id),
      service.start(firstProfile.id),
    ]);
    expect(sameProfile.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(sameProfile.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    expect(sameProfile.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "ACTIVE_BROWSER_RUN_CONFLICT" },
    });

    await expect(service.start(secondProfile.id)).resolves.toMatchObject({
      profileId: secondProfile.id,
      status: "starting",
    });
    await waitForBackgroundTasks(service);
    expect(runtime.launchCalls).toHaveLength(2);
  });

  test("marks a pre-spawn failure as failed and releases occupancy", async () => {
    const runtime = new FakeBrowserRuntime({
      launchPlans: [{ outcome: "fail-before-spawn", failureCode: "ENGINE_NOT_READY" }],
    });
    const { service, runs } = createService(runtime);

    await expect(service.start(firstProfile.id)).resolves.toMatchObject({
      status: "starting",
    });
    await waitForBackgroundTasks(service);
    expect(runs.all()).toMatchObject([
      { status: "failed", failureCode: "ENGINE_NOT_READY" },
    ]);
    await expect(service.start(firstProfile.id)).resolves.toMatchObject({
      status: "starting",
    });
    await waitForBackgroundTasks(service);
    await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
      status: "running",
    });
  });

  test("cleans a spawned process when launch state is uncertain and stop succeeds", async () => {
    const runtime = new FakeBrowserRuntime({
      launchPlans: [{ outcome: "fail-after-spawn", failureCode: "METADATA_UNKNOWN" }],
    });
    const { service, runs } = createService(runtime);

    await expect(service.start(firstProfile.id)).resolves.toMatchObject({
      status: "starting",
    });
    await waitForBackgroundTasks(service);
    expect(runtime.activeProcesses()).toEqual([]);
    expect(runs.all()).toMatchObject([
      { status: "failed", failureCode: "METADATA_UNKNOWN" },
    ]);
  });

  test("preserves occupancy when spawned-process cleanup times out", async () => {
    const runtime = new FakeBrowserRuntime({
      launchPlans: [{ outcome: "fail-after-spawn", failureCode: "METADATA_UNKNOWN" }],
      stopPlans: [{ outcome: "timeout" }],
    });
    const { service, runs } = createService(runtime);

    await expect(service.start(firstProfile.id)).resolves.toMatchObject({
      status: "starting",
    });
    await waitForBackgroundTasks(service);
    expect(runs.all()).toMatchObject([
      {
        status: "recovery_required",
        processPid: 10_000,
        processIdentity: "profile-001:run-1:fake-process-001",
      },
    ]);
    expect(runtime.activeProcesses()).toHaveLength(1);
  });

  test("preserves occupancy when spawned-process cleanup throws", async () => {
    const runtime = new ThrowingCleanupRuntime();
    const { service, runs } = createService(runtime);

    await expect(service.start(firstProfile.id)).resolves.toMatchObject({
      status: "starting",
    });
    await waitForBackgroundTasks(service);
    expect(runs.all()).toMatchObject([
      {
        status: "recovery_required",
        processPid: 10_000,
        processIdentity: "profile-001:run-1:fake-process-001",
        failureCode: "RUNTIME_STOP_STATE_UNKNOWN",
      },
    ]);
    expect(runtime.inner.activeProcesses()).toHaveLength(1);
  });

  test("stops a running profile and makes a repeated stop a no-op", async () => {
    const runtime = new FakeBrowserRuntime();
    const { service } = createService(runtime);
    const started = await service.start(firstProfile.id);
    await waitForBackgroundTasks(service);

    await expect(service.stop(firstProfile.id)).resolves.toMatchObject({
      accepted: true,
      run: { id: started.id, status: "stopping" },
    });
    await waitForBackgroundTasks(service);
    await expect(service.stop(firstProfile.id)).resolves.toMatchObject({
      accepted: false,
      run: { id: started.id, status: "stopped" },
    });
    expect(runtime.stopCalls).toHaveLength(1);
  });

  test("rejects stop immediately during a delayed start", async () => {
    const runtime = new DeferredLaunchRuntime();
    const { service } = createService(runtime);

    await expect(service.start(firstProfile.id)).resolves.toMatchObject({
      status: "starting",
    });
    await runtime.waitUntilLaunchStarts();
    await expect(service.stop(firstProfile.id)).rejects.toMatchObject({
      code: "BROWSER_RUN_START_IN_PROGRESS",
    });
    expect(runtime.stopCalls).toHaveLength(0);
    runtime.releaseLaunch();
    await waitForBackgroundTasks(service);
    await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
      status: "running",
    });
  });

  test("keeps occupancy after launch timeout and cleans a late process", async () => {
    const runtime = new DeferredLaunchRuntime();
    const { service, runs } = createService(runtime, undefined, undefined, {
      launchTimeoutMs: 20,
    });

    await service.start(firstProfile.id);
    await runtime.waitUntilLaunchStarts();
    await vi.waitFor(async () => {
      expect(await runs.findActiveByProfileId(firstProfile.id)).toMatchObject({
        status: "recovery_required",
        failureCode: "RUNTIME_LAUNCH_TIMEOUT",
      });
    });
    await expect(service.start(firstProfile.id)).rejects.toMatchObject({
      code: "ACTIVE_BROWSER_RUN_CONFLICT",
    });

    runtime.releaseLaunch();
    await waitForBackgroundTasks(service);
    expect(runtime.inner.activeProcesses()).toEqual([]);
    await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
      status: "failed",
    });
  });

  test("repeated stop during stopping reuses the command", async () => {
    const runtime = new DeferredStopRuntime();
    const { service } = createService(runtime);
    await service.start(firstProfile.id);
    await waitForBackgroundTasks(service);

    const first = await service.stop(firstProfile.id);
    await runtime.waitUntilStopStarts();
    const repeated = await service.stop(firstProfile.id);
    expect(first).toMatchObject({ accepted: true, run: { status: "stopping" } });
    expect(repeated).toMatchObject({ accepted: true, run: { id: first.run?.id } });
    expect(runtime.stopInvocations).toBe(1);

    runtime.releaseStop();
    await waitForBackgroundTasks(service);
    await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
      status: "stopped",
    });
  });

  test("late stop success clears recovery after a command timeout", async () => {
    const runtime = new DeferredStopRuntime();
    const { service, runs } = createService(runtime, undefined, undefined, {
      stopTimeoutMs: 20,
    });
    await service.start(firstProfile.id);
    await waitForBackgroundTasks(service);
    await service.stop(firstProfile.id);
    await runtime.waitUntilStopStarts();

    await vi.waitFor(async () => {
      expect(await runs.findActiveByProfileId(firstProfile.id)).toMatchObject({
        status: "recovery_required",
        failureCode: "RUNTIME_STOP_TIMEOUT",
      });
    });
    await expect(service.stop(firstProfile.id)).rejects.toMatchObject({
      code: "BROWSER_RUNTIME_RECOVERY_REQUIRED",
    });

    runtime.releaseStop();
    await waitForBackgroundTasks(service);
    await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
      status: "stopped",
    });
  });

  test("keeps occupancy after a stop timeout", async () => {
    const runtime = new FakeBrowserRuntime({
      stopPlans: [{ outcome: "timeout" }],
    });
    const { service, runs } = createService(runtime);
    await service.start(firstProfile.id);
    await waitForBackgroundTasks(service);

    await expect(service.stop(firstProfile.id)).resolves.toMatchObject({
      accepted: true,
      run: { status: "stopping" },
    });
    await waitForBackgroundTasks(service);
    expect(runs.all()).toMatchObject([{ status: "recovery_required" }]);
    expect(runtime.activeProcesses()).toHaveLength(1);
  });

  test("distinguishes unexpected exit from an expected stop", async () => {
    const runtime = new FakeBrowserRuntime();
    const { service, runs } = createService(runtime);
    const started = await service.start(firstProfile.id);
    await waitForBackgroundTasks(service);
    const process = runtime.activeProcesses()[0]!;

    runtime.emitUnexpectedExit(process, { code: 17, signal: "SIGTERM" });
    await flushRuntimeEvents();
    expect(runs.all()).toMatchObject([
      { id: started.id, status: "failed", failureCode: "RUNTIME_UNEXPECTED_EXIT" },
    ]);
    expect(service.pendingEventErrors).toEqual([]);

    const secondRuntime = new FakeBrowserRuntime();
    const second = createService(secondRuntime);
    await second.service.start(firstProfile.id);
    await waitForBackgroundTasks(second.service);
    await expect(second.service.stop(firstProfile.id)).resolves.toMatchObject({
      accepted: true,
      run: { status: "stopping" },
    });
    await waitForBackgroundTasks(second.service);
    await flushRuntimeEvents();
    expect(second.runs.all()).toMatchObject([{ status: "stopped", failureCode: null }]);
    expect(second.service.pendingEventErrors).toEqual([]);
  });

  test("keeps a persisted starting run occupied when stop is rejected", async () => {
    const runtime = new FakeBrowserRuntime();
    const runs = new MemoryBrowserRunRepository();
    await runs.create({
      id: "run-persisted",
      profileId: firstProfile.id,
      status: "starting" satisfies BrowserRunStatus,
      processPid: null,
      processIdentity: null,
      failureCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
    });
    const { service } = createService(runtime, new MemoryProfileRepository(), runs);

    await expect(service.stop(firstProfile.id)).rejects.toMatchObject({
      code: "BROWSER_RUN_START_IN_PROGRESS",
    });
    await expect(runs.findById("run-persisted")).resolves.toMatchObject({
      status: "starting",
      failureCode: null,
    });
  });
});
