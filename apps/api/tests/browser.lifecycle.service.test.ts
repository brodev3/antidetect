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
  RuntimeExit,
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

const confirmedExitCases = [
  {
    exit: { kind: "normal", code: 17, signal: null },
    status: "stopped",
    failureCode: null,
  },
  {
    exit: { kind: "abnormal", code: 0, signal: null },
    status: "failed",
    failureCode: "RUNTIME_UNEXPECTED_EXIT",
  },
  {
    exit: { kind: "unknown", code: 0, signal: null },
    status: "failed",
    failureCode: "RUNTIME_EXIT_REASON_UNKNOWN",
  },
] as const;

function emitConfirmedExit(
  runtime: FakeBrowserRuntime,
  process: RuntimeProcess,
  exit: RuntimeExit,
): void {
  if (exit.kind === "normal") runtime.emitNormalExit(process, exit);
  else if (exit.kind === "abnormal") runtime.emitUnexpectedExit(process, exit);
  else runtime.emitUnknownExit(process, exit);
}

function createGate(): {
  readonly promise: Promise<void>;
  readonly release: () => void;
} {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

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

class DeferredCreateBrowserRunRepository extends MemoryBrowserRunRepository {
  private readonly createGate = createGate();
  private readonly createStartedGate = createGate();

  override async create(run: BrowserRun): Promise<BrowserRun> {
    this.createStartedGate.release();
    await this.createGate.promise;
    return super.create(run);
  }

  waitUntilCreateStarts(): Promise<void> {
    return this.createStartedGate.promise;
  }

  releaseCreate(): void {
    this.createGate.release();
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
    readonly recoveryTimeoutMs?: number;
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
        recoveryTimeoutMs: timeouts.recoveryTimeoutMs ?? 5_000,
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

async function createInterruptedStop(runtime: FakeBrowserRuntime): Promise<{
  readonly service: BrowserLifecycleService;
  readonly runs: MemoryBrowserRunRepository;
  readonly process: RuntimeProcess;
  readonly run: BrowserRun;
}> {
  const { service, runs } = createService(runtime);
  const launch = await runtime.launch({
    runId: "persisted-stop",
    profileId: firstProfile.id,
    profileDirectory: `C:/profiles/${firstProfile.id}`,
    identityRef: firstProfile.identityRef,
  });
  if (launch.status !== "started") throw new Error("Expected fake process to start");
  const run: BrowserRun = {
    id: "persisted-stop",
    profileId: firstProfile.id,
    status: "stopping",
    processPid: launch.process.pid,
    processIdentity: launch.process.processIdentity,
    failureCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    endedAt: null,
  };
  await runs.create(run);
  return { service, runs, process: launch.process, run };
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

  test("rejects fingerprint changes after shutdown", async () => {
    const { service, profiles } = createService(new FakeBrowserRuntime());
    const updateFingerprintSettings = vi.spyOn(profiles, "updateFingerprintSettings");

    await service.prepareForShutdown();

    await expect(service.updateFingerprintMode(firstProfile.id, false)).rejects.toThrow(
      "Browser lifecycle is shutting down",
    );
    expect(updateFingerprintSettings).not.toHaveBeenCalled();
    await expect(profiles.findById(firstProfile.id)).resolves.toEqual(firstProfile);
  });

  test("rejects a fingerprint change queued before shutdown", async () => {
    const runs = new DeferredCreateBrowserRunRepository();
    const { service, profiles } = createService(
      new FakeBrowserRuntime(),
      undefined,
      runs,
    );
    const updateFingerprintSettings = vi.spyOn(profiles, "updateFingerprintSettings");
    const start = service.start(firstProfile.id);
    let update: Promise<Profile> | undefined;
    let shutdown: Promise<void> | undefined;

    try {
      await runs.waitUntilCreateStarts();
      update = service.updateFingerprintMode(firstProfile.id, false);
      shutdown = service.prepareForShutdown();
      runs.releaseCreate();

      await expect(update).rejects.toThrow("Browser lifecycle is shutting down");
      await expect(start).resolves.toMatchObject({ status: "starting" });
      await shutdown;

      expect(updateFingerprintSettings).not.toHaveBeenCalled();
      await expect(profiles.findById(firstProfile.id)).resolves.toEqual(firstProfile);
    } finally {
      runs.releaseCreate();
      await Promise.allSettled([
        start,
        update ?? Promise.resolve(),
        shutdown ?? Promise.resolve(),
      ]);
      await waitForBackgroundTasks(service);
    }
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

  test("waits for accepted start persistence before draining shutdown", async () => {
    const runtime = new DeferredLaunchRuntime();
    const runs = new DeferredCreateBrowserRunRepository();
    const { service } = createService(runtime, undefined, runs, {
      shutdownTimeoutMs: 20,
    });
    const start = service.start(firstProfile.id);
    let shutdownCompleted = false;
    let shutdown: Promise<void> | undefined;

    try {
      await runs.waitUntilCreateStarts();
      shutdown = service.prepareForShutdown().then(() => {
        shutdownCompleted = true;
      });
      await flushRuntimeEvents();

      expect(shutdownCompleted).toBe(false);

      runs.releaseCreate();
      await expect(start).resolves.toMatchObject({ status: "starting" });
      await runtime.waitUntilLaunchStarts();
      await shutdown;

      await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
        status: "recovery_required",
        failureCode: "RUNTIME_SHUTDOWN_TIMEOUT",
      });

      runtime.releaseLaunch();
      await waitForBackgroundTasks(service);
      await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
        status: "recovery_required",
        failureCode: "RUNTIME_SHUTDOWN_TIMEOUT",
      });
    } finally {
      runs.releaseCreate();
      runtime.releaseLaunch();
      await Promise.allSettled([start, shutdown ?? Promise.resolve()]);
      await waitForBackgroundTasks(service);
    }
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

  test.each(["starting", "running", "stopping", "recovery_required"] as const)(
    "bounds shutdown while a persisted $0 run is being recovered",
    async (status) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const runtime = new FakeBrowserRuntime();
      const gate = createGate();
      const entered = createGate();
      const originalRecover = runtime.recover.bind(runtime);
      vi.spyOn(runtime, "recover").mockImplementationOnce(async (input) => {
        entered.release();
        await gate.promise;
        return originalRecover(input);
      });
      const { service, runs } = createService(runtime, undefined, undefined, {
        recoveryTimeoutMs: 10_000,
        shutdownTimeoutMs: 20,
      });
      const launch = await runtime.launch({
        runId: "persisted-recovery",
        profileId: firstProfile.id,
        profileDirectory: `C:/profiles/${firstProfile.id}`,
        identityRef: firstProfile.identityRef,
      });
      if (launch.status !== "started") throw new Error("Expected fake launch");
      await runs.create({
        id: "persisted-recovery",
        profileId: firstProfile.id,
        status,
        processPid: status === "starting" ? null : launch.process.pid,
        processIdentity: status === "starting" ? null : launch.process.processIdentity,
        failureCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        endedAt: null,
      });
      const recovery = service.recoverPersistedRuns();
      await entered.promise;
      let finished = false;
      const shutdown = service.prepareForShutdown().then(() => {
        finished = true;
      });
      try {
        await vi.advanceTimersByTimeAsync(20);
        await flushRuntimeEvents();
        expect(finished).toBe(true);
        await shutdown;
        const snapshot = await service.getLatest(firstProfile.id);
        expect(snapshot).toMatchObject({
          status: status === "running" ? "running" : "recovery_required",
          failureCode:
            status === "starting"
              ? "RUNTIME_SHUTDOWN_TIMEOUT"
              : status === "stopping"
                ? "RUNTIME_STOP_INTERRUPTED"
                : null,
          endedAt: null,
        });
        expect(vi.getTimerCount()).toBe(0);
        expect(service.pendingTaskCount).toBe(1);

        gate.release();
        await recovery;
        await waitForBackgroundTasks(service);
        expect(await service.getLatest(firstProfile.id)).toEqual(snapshot);
        expect(runtime.stopCalls).toEqual([]);
        expect(runtime.activeProcesses()).toHaveLength(1);
        expect(service.pendingEventErrors).toEqual([]);
      } finally {
        gate.release();
        await recovery;
        await shutdown;
        await waitForBackgroundTasks(service);
        vi.useRealTimers();
      }
    },
  );

  test.each([false, true])(
    "does not start recovery after shutdown is requested (finalized=$0)",
    async (finalized) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const runtime = new DeferredStopRuntime();
      const recover = vi.spyOn(runtime, "recover");
      const { service, runs } = createService(runtime, undefined, undefined, {
        shutdownTimeoutMs: 20,
      });
      await service.start(firstProfile.id);
      await service.start(secondProfile.id);
      await flushRuntimeEvents();
      await waitForBackgroundTasks(service);
      await service.stop(firstProfile.id);
      await runtime.waitUntilStopStarts();
      const shutdown = service.prepareForShutdown();
      try {
        if (finalized) {
          await vi.advanceTimersByTimeAsync(20);
          await shutdown;
        }
        const snapshot = await runs.listOccupying();
        await expect(service.recoverPersistedRuns()).resolves.toEqual(snapshot);
        expect(recover).not.toHaveBeenCalled();
        expect(runtime.inner.activeProcesses()).toHaveLength(2);
      } finally {
        runtime.releaseStop();
        await shutdown;
        await waitForBackgroundTasks(service);
        vi.useRealTimers();
      }
    },
  );

  test.each([
    { status: "running", deadline: false },
    { status: "running", deadline: true },
    { status: "recovery_required", deadline: false },
    { status: "recovery_required", deadline: true },
  ] as const)(
    "waits for a recovery write before finalizing shutdown ($status, deadline=$deadline)",
    async ({ status, deadline }) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const runtime = new FakeBrowserRuntime({
        recoveryPlans: status === "running" ? [{ outcome: "unknown" }] : [],
      });
      const { service, runs } = createService(runtime, undefined, undefined, {
        shutdownTimeoutMs: 20,
      });
      const launch = await runtime.launch({
        runId: "persisted-write",
        profileId: firstProfile.id,
        profileDirectory: `C:/profiles/${firstProfile.id}`,
        identityRef: firstProfile.identityRef,
      });
      if (launch.status !== "started") throw new Error("Expected fake launch");
      await runs.create({
        id: "persisted-write",
        profileId: firstProfile.id,
        status,
        processPid: launch.process.pid,
        processIdentity: launch.process.processIdentity,
        failureCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        endedAt: null,
      });
      const gate = createGate();
      const entered = createGate();
      const originalSave = runs.save.bind(runs);
      vi.spyOn(runs, "save").mockImplementationOnce(async (run) => {
        entered.release();
        await gate.promise;
        return originalSave(run);
      });
      const recovery = service.recoverPersistedRuns();
      await entered.promise;
      let finished = false;
      const shutdown = service.prepareForShutdown().then(() => {
        finished = true;
      });
      try {
        await flushRuntimeEvents();
        if (deadline) await vi.advanceTimersByTimeAsync(20);
        expect(finished).toBe(false);
        gate.release();
        await recovery;
        await shutdown;
        const snapshot = await service.getLatest(firstProfile.id);
        expect(snapshot?.status).toBe(
          status === "running" ? "recovery_required" : "running",
        );
        runtime.emitUnexpectedExit(launch.process);
        await flushRuntimeEvents();
        expect(await service.getLatest(firstProfile.id)).toEqual(snapshot);
        expect(service.pendingEventErrors).toEqual([]);
      } finally {
        gate.release();
        await recovery;
        await shutdown;
        await waitForBackgroundTasks(service);
        vi.useRealTimers();
      }
    },
  );

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
        runCreatedAt: timestamp,
        profileDirectory: "C:/profiles/profile-001",
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
        runCreatedAt: startingRun.createdAt,
        profileDirectory: "C:/profiles/profile-001",
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
        runCreatedAt: persistedRun.createdAt,
        profileDirectory: "C:/profiles/profile-001",
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
        runCreatedAt: timestamp,
        profileDirectory: "C:/profiles/profile-001",
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
        failureCode: "RUNTIME_UNEXPECTED_EXIT",
      },
    ]);
    await expect(restarted.service.getLatest(firstProfile.id)).resolves.toMatchObject({
      status: "failed",
      failureCode: "RUNTIME_UNEXPECTED_EXIT",
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
    const { service, runs } = createService(runtime);
    const started = await service.start(firstProfile.id);
    await waitForBackgroundTasks(service);

    await expect(service.stop(firstProfile.id)).resolves.toMatchObject({
      accepted: true,
      run: { id: started.id, status: "stopping" },
    });
    await waitForBackgroundTasks(service);
    const finished = await service.getLatest(firstProfile.id);
    expect(finished).toMatchObject({
      id: started.id,
      status: "stopped",
      failureCode: null,
    });
    expect(finished?.endedAt).not.toBeNull();
    expect(await runs.findActiveByProfileId(firstProfile.id)).toBeNull();

    await expect(service.stop(firstProfile.id)).resolves.toMatchObject({
      accepted: false,
      run: { id: started.id, status: "stopped" },
    });
    expect(runtime.stopCalls).toHaveLength(1);
  });

  test("keeps occupancy until recovery persists the confirmed exit after stop-save failure", async () => {
    const runtime = new DeferredStopRuntime();
    const { service, runs } = createService(runtime);
    const started = await service.start(firstProfile.id);
    await waitForBackgroundTasks(service);

    await expect(service.stop(firstProfile.id)).resolves.toMatchObject({
      accepted: true,
      run: { id: started.id, status: "stopping" },
    });
    await runtime.waitUntilStopStarts();
    const persistenceError = new Error("Simulated terminal run persistence failure");
    const save = runs.save.bind(runs);
    let rejectStoppedPersistence = true;
    vi.spyOn(runs, "save").mockImplementation(async (run) => {
      if (run.status === "stopped" && rejectStoppedPersistence) {
        throw persistenceError;
      }
      return save(run);
    });

    runtime.releaseStop();
    await waitForBackgroundTasks(service);

    expect(service.pendingEventErrors).toContain(persistenceError);
    await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
      id: started.id,
      status: "stopping",
      endedAt: null,
    });
    await expect(runs.findActiveByProfileId(firstProfile.id)).resolves.toMatchObject({
      id: started.id,
      status: "stopping",
    });
    expect(runtime.inner.activeProcesses()).toEqual([]);

    rejectStoppedPersistence = false;
    await expect(service.recoverPersistedRuns()).resolves.toMatchObject([
      {
        id: started.id,
        status: "stopped",
        failureCode: null,
      },
    ]);
    await expect(runs.findActiveByProfileId(firstProfile.id)).resolves.toBeNull();
    await expect(service.getLatest(firstProfile.id)).resolves.toMatchObject({
      id: started.id,
      status: "stopped",
      endedAt: expect.any(String),
    });
    expect(runtime.inner.recoveryCalls).toHaveLength(1);
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

  test.each([false, true])(
    "does not recover an unresolved launch (timed out=$0)",
    async (timedOut) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const runtime = new DeferredLaunchRuntime();
      const recover = vi.spyOn(runtime, "recover");
      const { service, runs } = createService(runtime, undefined, undefined, {
        launchTimeoutMs: 20,
      });
      try {
        await service.start(firstProfile.id);
        await runtime.waitUntilLaunchStarts();
        if (timedOut) await vi.advanceTimersByTimeAsync(20);
        const pending = await service.getLatest(firstProfile.id);
        expect(pending?.status).toBe(timedOut ? "recovery_required" : "starting");

        await expect(service.recoverPersistedRuns()).resolves.toEqual([pending]);
        await expect(service.recoverPersistedRuns()).resolves.toEqual([pending]);
        expect(recover).not.toHaveBeenCalled();
        expect(await runs.findActiveByProfileId(firstProfile.id)).toEqual(pending);
        await expect(service.start(firstProfile.id)).rejects.toMatchObject({
          code: "ACTIVE_BROWSER_RUN_CONFLICT",
        });

        runtime.releaseLaunch();
        await flushRuntimeEvents();
        await waitForBackgroundTasks(service);
        expect(await service.getLatest(firstProfile.id)).toMatchObject({
          status: timedOut ? "failed" : "running",
        });
        if (!timedOut) {
          await service.recoverPersistedRuns();
          expect(recover).toHaveBeenCalledTimes(1);
        }
        expect(service.pendingEventErrors).toEqual([]);
      } finally {
        runtime.releaseLaunch();
        await waitForBackgroundTasks(service);
        vi.useRealTimers();
      }
    },
  );

  test.each([false, true])(
    "does not recover or duplicate an unresolved stop (cleanup=$0)",
    async (cleanup) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const runtime = new FakeBrowserRuntime({
        launchPlans: cleanup
          ? [{ outcome: "fail-after-spawn", failureCode: "METADATA_UNKNOWN" }]
          : [],
      });
      const gate = createGate();
      const entered = createGate();
      const originalStop = runtime.stop.bind(runtime);
      const stop = vi.spyOn(runtime, "stop").mockImplementationOnce(async (...args) => {
        entered.release();
        await gate.promise;
        return originalStop(...args);
      });
      const recover = vi.spyOn(runtime, "recover");
      const { service } = createService(runtime, undefined, undefined, {
        stopTimeoutMs: 20,
      });
      try {
        await service.start(firstProfile.id);
        if (!cleanup) {
          await waitForBackgroundTasks(service);
          await service.stop(firstProfile.id);
        }
        await entered.promise;
        await vi.advanceTimersByTimeAsync(20);
        const pending = await service.getLatest(firstProfile.id);
        expect(pending).toMatchObject({
          status: "recovery_required",
          failureCode: "RUNTIME_STOP_TIMEOUT",
        });
        await expect(service.recoverPersistedRuns()).resolves.toEqual([pending]);
        await expect(service.recoverPersistedRuns()).resolves.toEqual([pending]);
        expect(recover).not.toHaveBeenCalled();
        await expect(service.stop(firstProfile.id)).rejects.toMatchObject({
          code: "BROWSER_RUNTIME_RECOVERY_REQUIRED",
        });
        await expect(service.start(firstProfile.id)).rejects.toMatchObject({
          code: "ACTIVE_BROWSER_RUN_CONFLICT",
        });
        expect(stop).toHaveBeenCalledTimes(1);

        await service.start(secondProfile.id);
        await flushRuntimeEvents();
        expect(await service.getLatest(secondProfile.id)).toMatchObject({
          status: "running",
        });
        gate.release();
        await waitForBackgroundTasks(service);
        expect(await service.getLatest(firstProfile.id)).toMatchObject({
          status: cleanup ? "failed" : "stopped",
          failureCode: cleanup ? "METADATA_UNKNOWN" : null,
        });
        expect(stop).toHaveBeenCalledTimes(1);
        expect(service.pendingEventErrors).toEqual([]);
      } finally {
        gate.release();
        await waitForBackgroundTasks(service);
        vi.useRealTimers();
      }
    },
  );

  test("keeps a new run tracked after an older run's delayed stop response settles", async () => {
    const runtime = new FakeBrowserRuntime();
    const stopGate = createGate();
    const stopEntered = createGate();
    const launchGate = createGate();
    const launchEntered = createGate();
    const originalStop = runtime.stop.bind(runtime);
    vi.spyOn(runtime, "stop").mockImplementationOnce(async (...args) => {
      const result = await originalStop(...args);
      stopEntered.release();
      await stopGate.promise;
      return result;
    });
    const recover = vi.spyOn(runtime, "recover");
    const { service } = createService(runtime);
    try {
      const first = await service.start(firstProfile.id);
      await waitForBackgroundTasks(service);
      await service.stop(firstProfile.id);
      await stopEntered.promise;
      await flushRuntimeEvents();
      expect(await service.getLatest(firstProfile.id)).toMatchObject({
        id: first.id,
        status: "stopped",
      });
      expect(service.pendingTaskCount).toBeGreaterThan(0);

      const originalLaunch = runtime.launch.bind(runtime);
      vi.spyOn(runtime, "launch").mockImplementationOnce(async (input) => {
        launchEntered.release();
        await launchGate.promise;
        return originalLaunch(input);
      });
      const next = await service.start(firstProfile.id);
      expect(next.id).not.toBe(first.id);
      await launchEntered.promise;
      stopGate.release();
      await flushRuntimeEvents();
      await expect(service.recoverPersistedRuns()).resolves.toEqual([next]);
      expect(recover).not.toHaveBeenCalled();

      launchGate.release();
      await waitForBackgroundTasks(service);
      expect(await service.getLatest(firstProfile.id)).toMatchObject({
        id: next.id,
        status: "running",
      });
      expect(runtime.stopCalls).toHaveLength(1);
      expect(service.pendingEventErrors).toEqual([]);
    } finally {
      stopGate.release();
      launchGate.release();
      await waitForBackgroundTasks(service);
    }
  });

  test.each(["fail", "throw"] as const)(
    "allows recovery and a fresh stop after a late stop $0 settles",
    async (outcome) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const runtime = new FakeBrowserRuntime({
        stopPlans: outcome === "fail" ? [{ outcome: "fail" }] : [],
      });
      const gate = createGate();
      const entered = createGate();
      const originalStop = runtime.stop.bind(runtime);
      const stop = vi.spyOn(runtime, "stop").mockImplementationOnce(async (...args) => {
        entered.release();
        await gate.promise;
        if (outcome === "throw") throw new Error("Late stop result is unknown");
        return originalStop(...args);
      });
      const recover = vi.spyOn(runtime, "recover");
      const { service } = createService(runtime, undefined, undefined, {
        stopTimeoutMs: 20,
      });
      try {
        await service.start(firstProfile.id);
        await waitForBackgroundTasks(service);
        await service.stop(firstProfile.id);
        await entered.promise;
        await vi.advanceTimersByTimeAsync(20);
        await service.recoverPersistedRuns();
        expect(recover).not.toHaveBeenCalled();

        gate.release();
        await waitForBackgroundTasks(service);
        expect(await service.getLatest(firstProfile.id)).toMatchObject({
          status: "recovery_required",
        });
        await expect(service.recoverPersistedRuns()).resolves.toMatchObject([
          { status: "running" },
        ]);
        await expect(service.stop(firstProfile.id)).resolves.toMatchObject({
          accepted: true,
          run: { status: "stopping" },
        });
        await waitForBackgroundTasks(service);
        expect(stop).toHaveBeenCalledTimes(2);
        expect(recover).toHaveBeenCalledTimes(1);
        expect(await service.getLatest(firstProfile.id)).toMatchObject({
          status: "stopped",
        });
        expect(service.pendingEventErrors).toEqual([]);
      } finally {
        gate.release();
        await waitForBackgroundTasks(service);
        vi.useRealTimers();
      }
    },
  );

  test.each(["attached", "throw"] as const)(
    "does not overlap timed-out recovery lookups and ignores a late $0 result",
    async (lateResult) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const runtime = new FakeBrowserRuntime({ stopPlans: [{ outcome: "timeout" }] });
      const gate = createGate();
      const entered = createGate();
      const originalRecover = runtime.recover.bind(runtime);
      const recover = vi
        .spyOn(runtime, "recover")
        .mockImplementationOnce(async (input) => {
          entered.release();
          await gate.promise;
          if (lateResult === "throw")
            throw new Error("Late recovery result is unknown");
          return originalRecover(input);
        });
      const { service } = createService(runtime, undefined, undefined, {
        recoveryTimeoutMs: 20,
      });
      try {
        await service.start(firstProfile.id);
        await waitForBackgroundTasks(service);
        await service.stop(firstProfile.id);
        await waitForBackgroundTasks(service);
        const firstLookup = service.recoverPersistedRuns();
        await entered.promise;
        await vi.advanceTimersByTimeAsync(20);
        const pending = (await firstLookup)[0];
        expect(pending).toMatchObject({
          status: "recovery_required",
          failureCode: "RUNTIME_RECOVERY_TIMEOUT",
        });
        await expect(service.recoverPersistedRuns()).resolves.toEqual([pending]);
        await expect(service.recoverPersistedRuns()).resolves.toEqual([pending]);
        expect(recover).toHaveBeenCalledTimes(1);
        expect(service.pendingTaskCount).toBeGreaterThan(0);

        gate.release();
        await waitForBackgroundTasks(service);
        expect(await service.getLatest(firstProfile.id)).toEqual(pending);
        await expect(service.recoverPersistedRuns()).resolves.toMatchObject([
          { status: "running" },
        ]);
        expect(recover).toHaveBeenCalledTimes(2);
        expect(service.pendingEventErrors).toEqual([]);
      } finally {
        gate.release();
        await waitForBackgroundTasks(service);
        vi.useRealTimers();
      }
    },
  );

  test.each(["launch", "stop", "cleanup"] as const)(
    "tracks a late $0 result even if saving its timeout fails",
    async (operation) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const runtime = new FakeBrowserRuntime({
        launchPlans:
          operation === "cleanup"
            ? [{ outcome: "fail-after-spawn", failureCode: "METADATA_UNKNOWN" }]
            : [],
      });
      const gate = createGate();
      const entered = createGate();
      if (operation === "launch") {
        const originalLaunch = runtime.launch.bind(runtime);
        vi.spyOn(runtime, "launch").mockImplementationOnce(async (input) => {
          entered.release();
          await gate.promise;
          return originalLaunch(input);
        });
      } else {
        const originalStop = runtime.stop.bind(runtime);
        vi.spyOn(runtime, "stop").mockImplementationOnce(async (...args) => {
          entered.release();
          await gate.promise;
          return originalStop(...args);
        });
      }
      const recover = vi.spyOn(runtime, "recover");
      const { service, runs } = createService(runtime, undefined, undefined, {
        launchTimeoutMs: 20,
        stopTimeoutMs: 20,
      });
      const persistenceError = new Error("Simulated timeout persistence failure");
      try {
        await service.start(firstProfile.id);
        if (operation === "stop") {
          await flushRuntimeEvents();
          await waitForBackgroundTasks(service);
          await service.stop(firstProfile.id);
        }
        await entered.promise;
        runs.failNextSave = persistenceError;
        await vi.advanceTimersByTimeAsync(20);
        expect(service.pendingEventErrors).toEqual([persistenceError]);
        expect(service.pendingTaskCount).toBeGreaterThan(0);
        await service.recoverPersistedRuns();
        expect(recover).not.toHaveBeenCalled();

        gate.release();
        await waitForBackgroundTasks(service);
        expect(await service.getLatest(firstProfile.id)).toMatchObject({
          status: operation === "stop" ? "stopped" : "failed",
          failureCode:
            operation === "stop"
              ? null
              : operation === "launch"
                ? "RUNTIME_LAUNCH_TIMEOUT"
                : "METADATA_UNKNOWN",
        });
        expect(await runs.findActiveByProfileId(firstProfile.id)).toBeNull();
        expect(runtime.activeProcesses()).toEqual([]);
        expect(service.pendingEventErrors).toEqual([persistenceError]);
      } finally {
        gate.release();
        await waitForBackgroundTasks(service);
        vi.useRealTimers();
      }
    },
  );

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

  test.each(confirmedExitCases)(
    "classifies a spontaneous $exit.kind exit independently of its code",
    async ({ exit, status, failureCode }) => {
      const runtime = new FakeBrowserRuntime();
      const { service, runs } = createService(runtime);
      const started = await service.start(firstProfile.id);
      await waitForBackgroundTasks(service);

      const process = runtime.activeProcesses()[0];
      expect(process).toBeDefined();
      emitConfirmedExit(runtime, process!, exit);
      await flushRuntimeEvents();
      await waitForBackgroundTasks(service);

      const finished = await service.getLatest(firstProfile.id);
      expect(finished).toMatchObject({ id: started.id, status, failureCode });
      expect(finished?.endedAt).not.toBeNull();
      expect(await runs.findActiveByProfileId(firstProfile.id)).toBeNull();
      expect(await service.stop(firstProfile.id)).toEqual({
        accepted: false,
        run: finished,
      });
      expect(runtime.stopCalls).toEqual([]);
      expect(service.pendingEventErrors).toEqual([]);

      const next = await service.start(firstProfile.id);
      expect(next.id).not.toBe(started.id);
      await waitForBackgroundTasks(service);
      expect(await service.getLatest(firstProfile.id)).toMatchObject({
        id: next.id,
        status: "running",
      });
    },
  );

  test.each(
    confirmedExitCases.flatMap((exitCase) =>
      ([false, true] as const).flatMap((cleanup) =>
        (["event-first", "result-first"] as const).map((order) => ({
          ...exitCase,
          cleanup,
          order,
        })),
      ),
    ),
  )(
    "classifies $exit.kind with $order (cleanup=$cleanup)",
    async ({ exit, status, failureCode, cleanup, order }) => {
      const runtime = new FakeBrowserRuntime({
        launchPlans: cleanup
          ? [{ outcome: "fail-after-spawn", failureCode: "METADATA_UNKNOWN" }]
          : [],
        stopPlans: [{ outcome: "success", exit }],
      });
      let nowSequence = 0;
      const { service, runs } = createService(runtime, undefined, undefined, {
        now: () => new Date(Date.parse(timestamp) + nowSequence++).toISOString(),
      });
      const gate = createGate();
      if (order === "event-first") {
        const originalStop = runtime.stop.bind(runtime);
        vi.spyOn(runtime, "stop").mockImplementation(async (process, options) => {
          const result = await originalStop(process, options);
          await gate.promise;
          return result;
        });
      } else {
        const originalHandleExit = service.handleExit.bind(service);
        vi.spyOn(service, "handleExit").mockImplementation(async (runId, event) => {
          await gate.promise;
          return originalHandleExit(runId, event);
        });
      }

      try {
        await service.start(firstProfile.id);
        if (!cleanup) {
          await waitForBackgroundTasks(service);
          await service.stop(firstProfile.id);
        }
        await vi.waitFor(async () => {
          expect(await service.getLatest(firstProfile.id)).toMatchObject({
            status: cleanup ? "failed" : status,
            failureCode: cleanup ? "METADATA_UNKNOWN" : failureCode,
          });
        });
        const firstTerminalRun = await service.getLatest(firstProfile.id);
        expect(runtime.activeProcesses()).toEqual([]);
        expect(service.pendingTaskCount).toBeGreaterThan(0);

        gate.release();
        await flushRuntimeEvents();
        await waitForBackgroundTasks(service);
        expect(await service.getLatest(firstProfile.id)).toEqual(firstTerminalRun);
        expect(await runs.findActiveByProfileId(firstProfile.id)).toBeNull();
        expect(runtime.stopCalls).toHaveLength(1);
        expect(service.pendingEventErrors).toEqual([]);
      } finally {
        gate.release();
        await flushRuntimeEvents();
        await waitForBackgroundTasks(service);
      }
    },
  );

  test.each(confirmedExitCases)(
    "classifies an owned $exit.kind exit observed during API downtime",
    async ({ exit, status, failureCode }) => {
      const processHost = new FakeBrowserProcessHost();
      const runtime = new FakeBrowserRuntime({ processHost });
      const first = createService(runtime);
      await first.service.start(firstProfile.id);
      await waitForBackgroundTasks(first.service);

      const process = runtime.activeProcesses()[0];
      expect(process).toBeDefined();
      processHost.simulateApiProcessExit();
      emitConfirmedExit(runtime, process!, exit);

      const restartedRuntime = new FakeBrowserRuntime({ processHost });
      const restarted = createService(restartedRuntime, first.profiles, first.runs);
      await expect(restarted.service.recoverPersistedRuns()).resolves.toMatchObject([
        { id: "run-1", status, failureCode },
      ]);
      expect(await first.runs.findActiveByProfileId(firstProfile.id)).toBeNull();
      expect(restartedRuntime.stopCalls).toEqual([]);
      expect(restarted.service.pendingEventErrors).toEqual([]);
    },
  );

  test.each(["event", "recovery"] as const)(
    "fails a normal exit before running was persisted through $0",
    async (source) => {
      const processHost = new FakeBrowserProcessHost();
      const runtime = new FakeBrowserRuntime({ processHost });
      const first = createService(runtime);
      const persistenceError = new Error(
        "Simulated process metadata persistence failure",
      );
      first.runs.failNextSave = persistenceError;
      await first.service.start(firstProfile.id);
      await waitForBackgroundTasks(first.service);
      expect(await first.service.getLatest(firstProfile.id)).toMatchObject({
        status: "starting",
      });
      expect(first.service.pendingEventErrors).toEqual([persistenceError]);

      const process = runtime.activeProcesses()[0];
      expect(process).toBeDefined();
      if (source === "recovery") processHost.simulateApiProcessExit();
      runtime.emitNormalExit(process!);
      let service = first.service;
      if (source === "recovery") {
        service = createService(
          new FakeBrowserRuntime({ processHost }),
          first.profiles,
          first.runs,
        ).service;
        await service.recoverPersistedRuns();
      }
      await flushRuntimeEvents();
      await waitForBackgroundTasks(service);
      expect(await service.getLatest(firstProfile.id)).toMatchObject({
        status: "failed",
        failureCode: "RUNTIME_EXIT_BEFORE_RUNNING",
      });
      expect(await first.runs.findActiveByProfileId(firstProfile.id)).toBeNull();
      expect(service.pendingEventErrors).toEqual(
        source === "event" ? [persistenceError] : [],
      );
    },
  );

  test.each(confirmedExitCases)(
    "fails a synchronously observed $exit.kind exit before running is persisted",
    async ({ exit }) => {
      const runtime = new FakeBrowserRuntime();
      const launch = runtime.launch.bind(runtime);
      vi.spyOn(runtime, "launch").mockImplementation(async (input) => {
        const outcome = await launch(input);
        if (outcome.status === "started") {
          emitConfirmedExit(runtime, outcome.process, exit);
        }
        return outcome;
      });
      const { service, runs } = createService(runtime);
      const persistenceError = new Error(
        "Simulated process metadata persistence failure",
      );
      runs.failNextSave = persistenceError;

      await service.start(firstProfile.id);
      await flushRuntimeEvents();
      await waitForBackgroundTasks(service);

      expect(await service.getLatest(firstProfile.id)).toMatchObject({
        status: "failed",
        failureCode: "RUNTIME_EXIT_BEFORE_RUNNING",
      });
      expect(await runs.findActiveByProfileId(firstProfile.id)).toBeNull();
      expect(runtime.activeProcesses()).toHaveLength(0);
      expect(service.pendingEventErrors).toEqual([persistenceError]);
    },
  );

  test.each(
    confirmedExitCases.flatMap((exitCase) =>
      (["timeout", "fail"] as const).map((outcome) => ({ ...exitCase, outcome })),
    ),
  )(
    "preserves the launch failure after cleanup $outcome and a $exit.kind exit",
    async ({ exit, outcome }) => {
      const runtime = new FakeBrowserRuntime({
        launchPlans: [{ outcome: "fail-after-spawn", failureCode: "METADATA_UNKNOWN" }],
        stopPlans: [{ outcome }],
      });
      const { service } = createService(runtime);
      await service.start(firstProfile.id);
      await waitForBackgroundTasks(service);
      expect(await service.getLatest(firstProfile.id)).toMatchObject({
        status: "recovery_required",
        failureCode:
          outcome === "timeout" ? "RUNTIME_STOP_TIMEOUT" : "RUNTIME_STOP_FAILED",
      });

      const process = runtime.activeProcesses()[0];
      expect(process).toBeDefined();
      emitConfirmedExit(runtime, process!, exit);
      await flushRuntimeEvents();
      await waitForBackgroundTasks(service);
      expect(await service.getLatest(firstProfile.id)).toMatchObject({
        status: "failed",
        failureCode: "METADATA_UNKNOWN",
      });
      expect(service.pendingEventErrors).toEqual([]);
    },
  );

  test.each([
    { outcome: "attached", status: "running", failureCode: null },
    {
      outcome: "absent",
      status: "failed",
      failureCode: "RUNTIME_PROCESS_NOT_FOUND_DURING_RECOVERY",
    },
    { outcome: "normal-exit", status: "stopped", failureCode: null },
    {
      outcome: "abnormal-exit",
      status: "failed",
      failureCode: "RUNTIME_UNEXPECTED_EXIT",
    },
    {
      outcome: "unknown-exit",
      status: "failed",
      failureCode: "RUNTIME_EXIT_REASON_UNKNOWN",
    },
    {
      outcome: "unknown",
      status: "recovery_required",
      failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
    },
    {
      outcome: "pid-mismatch",
      status: "recovery_required",
      failureCode: "RUNTIME_PROCESS_IDENTITY_MISMATCH",
    },
    {
      outcome: "identity-mismatch",
      status: "recovery_required",
      failureCode: "RUNTIME_PROCESS_IDENTITY_MISMATCH",
    },
    {
      outcome: "throw",
      status: "recovery_required",
      failureCode: "RUNTIME_RECOVERY_LOOKUP_FAILED",
    },
    {
      outcome: "timeout",
      status: "recovery_required",
      failureCode: "RUNTIME_RECOVERY_TIMEOUT",
    },
  ] as const)(
    "recovers an interrupted stopping run through $outcome",
    async ({ outcome, status, failureCode }) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const runtime = new FakeBrowserRuntime();
      const { service, runs, process, run } = await createInterruptedStop(runtime);
      const lookupGate = createGate();
      const lookupEntered = createGate();
      const originalRecover = runtime.recover.bind(runtime);
      if (outcome === "absent") {
        runtime.emitNormalExit(process);
        vi.spyOn(runtime, "recover").mockResolvedValue({ status: "absent" });
      } else if (outcome === "normal-exit") runtime.emitNormalExit(process);
      else if (outcome === "abnormal-exit") runtime.emitUnexpectedExit(process);
      else if (outcome === "unknown-exit") runtime.emitUnknownExit(process);
      else if (outcome === "unknown") {
        vi.spyOn(runtime, "recover").mockResolvedValue({
          status: "unknown",
          failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
        });
      } else if (outcome === "pid-mismatch" || outcome === "identity-mismatch") {
        vi.spyOn(runtime, "recover").mockResolvedValue({
          status: "attached",
          process: {
            ...process,
            pid: outcome === "pid-mismatch" ? (process.pid ?? 0) + 1 : process.pid,
            processIdentity:
              outcome === "identity-mismatch"
                ? "foreign-process"
                : process.processIdentity,
          },
        });
      } else if (outcome === "throw") {
        vi.spyOn(runtime, "recover").mockRejectedValue(
          new Error("Recovery lookup failed"),
        );
      } else if (outcome === "timeout") {
        vi.spyOn(runtime, "recover").mockImplementationOnce(async (input) => {
          lookupEntered.release();
          await lookupGate.promise;
          return originalRecover(input);
        });
      }
      try {
        const recovery = service.recoverPersistedRuns();
        if (outcome === "timeout") {
          await flushRuntimeEvents();
          expect(service.pendingTaskCount).toBeGreaterThan(0);
          await lookupEntered.promise;
          await vi.advanceTimersByTimeAsync(5_000);
        }
        await expect(recovery).resolves.toMatchObject([
          { id: run.id, status, failureCode },
        ]);
        const recovered = await service.getLatest(firstProfile.id);
        expect(recovered).toMatchObject({ id: run.id, status, failureCode });
        expect(runtime.stopCalls).toEqual([]);
        expect(runtime.launchCalls).toHaveLength(1);

        if (status === "running") {
          expect(await runs.findActiveByProfileId(firstProfile.id)).toEqual(recovered);
          await expect(service.start(firstProfile.id)).rejects.toMatchObject({
            code: "ACTIVE_BROWSER_RUN_CONFLICT",
          });
          await expect(service.stop(firstProfile.id)).resolves.toMatchObject({
            accepted: true,
            run: { id: run.id, status: "stopping" },
          });
          await flushRuntimeEvents();
          await waitForBackgroundTasks(service);
          expect(runtime.stopCalls).toHaveLength(1);
          expect(await service.getLatest(firstProfile.id)).toMatchObject({
            status: "stopped",
          });
        } else if (status === "recovery_required") {
          expect(await runs.findActiveByProfileId(firstProfile.id)).toEqual(recovered);
          await expect(service.start(firstProfile.id)).rejects.toMatchObject({
            code: "ACTIVE_BROWSER_RUN_CONFLICT",
          });
          await expect(service.stop(firstProfile.id)).rejects.toMatchObject({
            code: "BROWSER_RUNTIME_RECOVERY_REQUIRED",
          });
        } else {
          expect(recovered?.endedAt).not.toBeNull();
          expect(await runs.findActiveByProfileId(firstProfile.id)).toBeNull();
          await expect(service.stop(firstProfile.id)).resolves.toEqual({
            accepted: false,
            run: recovered,
          });
          const next = await service.start(firstProfile.id);
          expect(next.id).not.toBe(run.id);
          await flushRuntimeEvents();
          await waitForBackgroundTasks(service);
          expect(await service.getLatest(firstProfile.id)).toMatchObject({
            id: next.id,
            status: "running",
          });
        }
        expect(service.pendingEventErrors).toEqual([]);
      } finally {
        lookupGate.release();
        await flushRuntimeEvents();
        await waitForBackgroundTasks(service);
        vi.useRealTimers();
      }
    },
  );

  test("rejects an orphaned stop command until its process is verified", async () => {
    const runtime = new FakeBrowserRuntime();
    const { service, runs, run } = await createInterruptedStop(runtime);
    await expect(service.stop(firstProfile.id)).rejects.toMatchObject({
      code: "BROWSER_RUNTIME_RECOVERY_REQUIRED",
      failureCode: "RUNTIME_STOP_INTERRUPTED",
    });
    expect(await runs.findById(run.id)).toMatchObject({
      status: "recovery_required",
      failureCode: "RUNTIME_STOP_INTERRUPTED",
    });
    expect(runtime.stopCalls).toEqual([]);
    await expect(service.recoverPersistedRuns()).resolves.toMatchObject([
      { id: run.id, status: "running" },
    ]);
    await service.stop(firstProfile.id);
    await waitForBackgroundTasks(service);
    expect(runtime.stopCalls).toHaveLength(1);
    expect(service.pendingEventErrors).toEqual([]);
  });

  test("keeps an active stop command while recovery is requested", async () => {
    const runtime = new DeferredStopRuntime();
    const { service } = createService(runtime);
    try {
      await service.start(firstProfile.id);
      await waitForBackgroundTasks(service);
      const command = await service.stop(firstProfile.id);
      await runtime.waitUntilStopStarts();
      await expect(service.recoverPersistedRuns()).resolves.toEqual([command.run]);
      await expect(service.stop(firstProfile.id)).resolves.toEqual(command);
      expect(runtime.stopInvocations).toBe(1);
      expect(runtime.inner.recoveryCalls).toEqual([]);
    } finally {
      runtime.releaseStop();
      await waitForBackgroundTasks(service);
    }
  });

  test("does not inspect processes when persisting an interrupted stop fails", async () => {
    const runtime = new FakeBrowserRuntime();
    const { service, runs, run } = await createInterruptedStop(runtime);
    const persistenceError = new Error(
      "Simulated interrupted-stop persistence failure",
    );
    runs.failNextSave = persistenceError;
    await expect(service.recoverPersistedRuns()).rejects.toBe(persistenceError);
    expect(await runs.findById(run.id)).toEqual(run);
    expect(runtime.recoveryCalls).toEqual([]);
    expect(runtime.stopCalls).toEqual([]);
    await expect(service.recoverPersistedRuns()).resolves.toMatchObject([
      { status: "running" },
    ]);
  });

  test.each(confirmedExitCases)(
    "discards stale cleanup context after reattachment and a $exit.kind exit",
    async ({ exit, status, failureCode }) => {
      const runtime = new FakeBrowserRuntime({
        launchPlans: [{ outcome: "fail-after-spawn", failureCode: "METADATA_UNKNOWN" }],
        stopPlans: [{ outcome: "fail" }],
      });
      const { service } = createService(runtime);
      await service.start(firstProfile.id);
      await waitForBackgroundTasks(service);
      const process = runtime.activeProcesses()[0];
      expect(process).toBeDefined();
      await expect(service.recoverPersistedRuns()).resolves.toMatchObject([
        { status: "running", failureCode: null },
      ]);
      emitConfirmedExit(runtime, process!, exit);
      await flushRuntimeEvents();
      await waitForBackgroundTasks(service);
      expect(await service.getLatest(firstProfile.id)).toMatchObject({
        status,
        failureCode,
      });
      expect(service.pendingEventErrors).toEqual([]);
    },
  );

  test.each(["unknown", "identity-mismatch", "save-failure"] as const)(
    "retains cleanup context when reattachment ends with $0",
    async (outcome) => {
      const runtime = new FakeBrowserRuntime({
        launchPlans: [{ outcome: "fail-after-spawn", failureCode: "METADATA_UNKNOWN" }],
        stopPlans: [{ outcome: "fail" }],
      });
      const { service, runs } = createService(runtime);
      await service.start(firstProfile.id);
      await waitForBackgroundTasks(service);
      const process = runtime.activeProcesses()[0];
      expect(process).toBeDefined();
      if (outcome === "unknown") {
        vi.spyOn(runtime, "recover").mockResolvedValue({
          status: "unknown",
          failureCode: "UNVERIFIED",
        });
      } else if (outcome === "identity-mismatch") {
        vi.spyOn(runtime, "recover").mockResolvedValue({
          status: "attached",
          process: { ...process!, processIdentity: "foreign-process" },
        });
      }
      if (outcome === "save-failure") {
        const persistenceError = new Error(
          "Simulated recovered-state persistence failure",
        );
        runs.failNextSave = persistenceError;
        await expect(service.recoverPersistedRuns()).rejects.toBe(persistenceError);
      } else {
        await expect(service.recoverPersistedRuns()).resolves.toMatchObject([
          { status: "recovery_required" },
        ]);
      }
      runtime.emitNormalExit(process!);
      await flushRuntimeEvents();
      await waitForBackgroundTasks(service);
      expect(await service.getLatest(firstProfile.id)).toMatchObject({
        status: "failed",
        failureCode: "METADATA_UNKNOWN",
      });
      expect(service.pendingEventErrors).toEqual([]);
    },
  );

  test("renews an exit subscription after a previous registration was lost", async () => {
    const processHost = new FakeBrowserProcessHost();
    const runtime = new FakeBrowserRuntime({ processHost });
    const { service } = createService(runtime);
    await service.start(firstProfile.id);
    await waitForBackgroundTasks(service);
    const process = runtime.activeProcesses()[0];
    expect(process).toBeDefined();
    processHost.simulateApiProcessExit();
    await service.recoverPersistedRuns();
    runtime.emitNormalExit(process!);
    await flushRuntimeEvents();
    await waitForBackgroundTasks(service);
    expect(await service.getLatest(firstProfile.id)).toMatchObject({
      status: "stopped",
    });
    expect(service.pendingEventErrors).toEqual([]);
  });

  test("releases cleanup context and its subscription after confirmed absence", async () => {
    const processHost = new FakeBrowserProcessHost();
    const runtime = new FakeBrowserRuntime({
      processHost,
      launchPlans: [{ outcome: "fail-after-spawn", failureCode: "METADATA_UNKNOWN" }],
      stopPlans: [{ outcome: "fail" }],
      recoveryPlans: [{ outcome: "absent" }],
    });
    const unsubscribed = vi.fn();
    const originalLaunch = runtime.launch.bind(runtime);
    vi.spyOn(runtime, "launch").mockImplementationOnce(async (input) => {
      const launch = await originalLaunch(input);
      if (launch.status !== "failed_before_spawn" && launch.process !== null) {
        const subscribe = launch.process.onExit.bind(launch.process);
        vi.spyOn(launch.process, "onExit").mockImplementation((listener) => {
          const unsubscribe = subscribe(listener);
          return () => {
            unsubscribed();
            unsubscribe();
          };
        });
      }
      return launch;
    });
    const { service, runs } = createService(runtime);
    await service.start(firstProfile.id);
    await waitForBackgroundTasks(service);
    const process = runtime.activeProcesses()[0];
    expect(process).toBeDefined();
    processHost.simulateApiProcessExit();
    runtime.emitNormalExit(process!);
    await expect(service.recoverPersistedRuns()).resolves.toMatchObject([
      { status: "failed", failureCode: "METADATA_UNKNOWN" },
    ]);
    expect(unsubscribed).toHaveBeenCalledTimes(1);
    expect(await runs.findActiveByProfileId(firstProfile.id)).toBeNull();
    expect(service.pendingEventErrors).toEqual([]);
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
