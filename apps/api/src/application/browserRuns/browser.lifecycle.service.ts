import { randomUUID } from "node:crypto";
import { ProfileNotFoundError } from "../profiles/profile.errors.js";
import type { Profile, ProfileRepository } from "../profiles/profile.repository.js";
import { ProfileOperationMutex } from "../lifecycle/profile.operation.mutex.js";
import type {
  BrowserRuntime,
  RuntimeExit,
  RuntimeLaunchInput,
  RuntimeLaunchResult,
  RuntimeProcess,
  RuntimeRecoveryInput,
  RuntimeRecoveryResult,
  RuntimeStopResult,
} from "../runtime/browser.runtime.js";
import {
  ActiveBrowserRunConflictError,
  BrowserRunStartingError,
  BrowserRuntimeRecoveryRequiredError,
  BrowserRunNotFoundError,
} from "./browser.run.errors.js";
import type { BrowserRun, BrowserRunRepository } from "./browser.run.repository.js";
import {
  isBrowserRunTerminal,
  transitionBrowserRun,
  type BrowserRunStatus,
} from "./browser.run.state.js";

export interface BrowserLifecycleServiceOptions {
  readonly profileDirectoryFor: (profileId: string) => string;
  readonly now?: () => string;
  readonly createRunId?: () => string;
  readonly createFingerprintIdentityRef?: () => string;
  readonly launchTimeoutMs?: number;
  readonly recoveryTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
}

export interface BrowserStopCommandResult {
  readonly accepted: boolean;
  readonly run: BrowserRun | null;
}

interface RuntimeHandleRecord {
  readonly process: RuntimeProcess;
  readonly unsubscribe: () => void;
}

type TimedResult<T> =
  | { readonly kind: "resolved"; readonly value: T }
  | { readonly kind: "rejected" }
  | { readonly kind: "timed_out" };

const defaultLaunchTimeoutMs = 30_000;
const defaultRecoveryTimeoutMs = 10_000;
const defaultStopTimeoutMs = 10_000;
const defaultShutdownTimeoutMs = 5_000;

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<TimedResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value): TimedResult<T> => ({ kind: "resolved", value }),
        (): TimedResult<T> => ({ kind: "rejected" }),
      ),
      new Promise<TimedResult<T>>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timed_out" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class BrowserLifecycleService {
  private readonly now: () => string;
  private readonly createRunId: () => string;
  private readonly createFingerprintIdentityRef: () => string;
  private readonly launchTimeoutMs: number;
  private readonly recoveryTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly handles = new Map<string, RuntimeHandleRecord>();
  private readonly expectedStops = new Set<string>();
  private readonly cleanupStops = new Set<string>();
  private readonly eventErrors: unknown[] = [];
  private readonly backgroundTasks = new Set<Promise<void>>();
  private shutdownRequested = false;
  private shutdownFinalized = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly runs: BrowserRunRepository,
    private readonly runtime: BrowserRuntime,
    private readonly mutex: ProfileOperationMutex = new ProfileOperationMutex(),
    private readonly options: BrowserLifecycleServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createRunId = options.createRunId ?? randomUUID;
    this.createFingerprintIdentityRef =
      options.createFingerprintIdentityRef ?? (() => `test-identity:${randomUUID()}`);
    this.launchTimeoutMs = options.launchTimeoutMs ?? defaultLaunchTimeoutMs;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? defaultRecoveryTimeoutMs;
    this.stopTimeoutMs = options.stopTimeoutMs ?? defaultStopTimeoutMs;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? defaultShutdownTimeoutMs;
    if (!Number.isSafeInteger(this.launchTimeoutMs) || this.launchTimeoutMs <= 0) {
      throw new TypeError("launchTimeoutMs must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.stopTimeoutMs) || this.stopTimeoutMs <= 0) {
      throw new TypeError("stopTimeoutMs must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.recoveryTimeoutMs) || this.recoveryTimeoutMs <= 0) {
      throw new TypeError("recoveryTimeoutMs must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.shutdownTimeoutMs) || this.shutdownTimeoutMs <= 0) {
      throw new TypeError("shutdownTimeoutMs must be a positive safe integer");
    }
  }

  get pendingEventErrors(): readonly unknown[] {
    return this.eventErrors;
  }

  get pendingTaskCount(): number {
    return this.backgroundTasks.size;
  }

  prepareForShutdown(): Promise<void> {
    this.shutdownPromise ??= this.drainForShutdown();
    return this.shutdownPromise;
  }

  async updateFingerprintMode(
    profileId: string,
    fingerprintEnabled: boolean,
  ): Promise<Profile> {
    return this.mutex.runExclusive(profileId, async () => {
      const profile = await this.profiles.findById(profileId);
      if (profile === null) {
        throw new ProfileNotFoundError(profileId);
      }
      if (profile.fingerprintEnabled === fingerprintEnabled) {
        return profile;
      }

      const activeRun = await this.runs.findActiveByProfileId(profileId);
      if (activeRun !== null) {
        throw new ActiveBrowserRunConflictError(profileId, activeRun.id);
      }

      const identityRef = fingerprintEnabled
        ? (profile.identityRef ?? this.createFingerprintIdentityRef())
        : profile.identityRef;
      const updatedProfile = await this.profiles.updateFingerprintSettings(profileId, {
        fingerprintEnabled,
        identityRef,
        updatedAt: this.now(),
      });
      if (updatedProfile === null) {
        throw new ProfileNotFoundError(profileId);
      }

      return updatedProfile;
    });
  }

  async start(profileId: string): Promise<BrowserRun> {
    this.assertAcceptingCommands();
    return this.mutex.runExclusive(profileId, async () => {
      this.assertAcceptingCommands();
      const profile = await this.profiles.findById(profileId);
      if (profile === null) {
        throw new ProfileNotFoundError(profileId);
      }

      const activeRun = await this.runs.findActiveByProfileId(profileId);
      if (activeRun !== null) {
        throw new ActiveBrowserRunConflictError(profileId, activeRun.id);
      }

      const profileDirectory = this.options.profileDirectoryFor(profile.id);
      const timestamp = this.now();
      const startingRun: BrowserRun = {
        id: this.createRunId(),
        profileId,
        status: "starting",
        processPid: null,
        processIdentity: null,
        failureCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        endedAt: null,
      };
      await this.runs.create(startingRun);
      this.schedule(() =>
        this.performLaunch(startingRun, {
          runId: startingRun.id,
          profileId: profile.id,
          profileDirectory,
          identityRef: profile.fingerprintEnabled ? profile.identityRef : null,
        }),
      );
      return startingRun;
    });
  }

  async getLatest(profileId: string): Promise<BrowserRun | null> {
    const profile = await this.profiles.findById(profileId);
    if (profile === null) {
      throw new ProfileNotFoundError(profileId);
    }

    return this.runs.findLatestByProfileId(profileId);
  }

  async recoverPersistedRuns(): Promise<readonly BrowserRun[]> {
    const occupyingRuns = await this.runs.listOccupying();
    const recoveredRuns: BrowserRun[] = [];
    for (const run of occupyingRuns) {
      if (
        run.status !== "starting" &&
        run.status !== "running" &&
        run.status !== "recovery_required"
      ) {
        continue;
      }
      recoveredRuns.push(await this.recoverPersistedRun(run));
    }
    return recoveredRuns;
  }

  async stop(profileId: string): Promise<BrowserStopCommandResult> {
    this.assertAcceptingCommands();
    return this.mutex.runExclusive(profileId, async () => {
      this.assertAcceptingCommands();
      const profile = await this.profiles.findById(profileId);
      if (profile === null) {
        throw new ProfileNotFoundError(profileId);
      }

      const activeRun = await this.runs.findActiveByProfileId(profileId);
      if (activeRun === null) {
        return {
          accepted: false,
          run: await this.runs.findLatestByProfileId(profileId),
        };
      }

      if (activeRun.status === "starting") {
        throw new BrowserRunStartingError(activeRun.id);
      }
      if (activeRun.status === "stopping") {
        return { accepted: true, run: activeRun };
      }
      if (activeRun.status === "recovery_required") {
        throw new BrowserRuntimeRecoveryRequiredError(
          activeRun.id,
          activeRun.failureCode ?? "RUNTIME_RECOVERY_REQUIRED",
        );
      }

      const handle = this.handles.get(activeRun.id);
      if (handle === undefined) {
        const recovery = await this.saveStatus(activeRun, "recovery_required", {
          failureCode: "RUNTIME_HANDLE_UNAVAILABLE",
        });
        throw new BrowserRuntimeRecoveryRequiredError(
          recovery.id,
          "RUNTIME_HANDLE_UNAVAILABLE",
        );
      }

      const stoppingRun = await this.saveStatus(activeRun, "stopping", {
        failureCode: null,
      });
      this.expectedStops.add(activeRun.id);
      this.schedule(() => this.performStop(stoppingRun, handle.process));
      return { accepted: true, run: stoppingRun };
    });
  }

  async handleExit(runId: string, exit: RuntimeExit): Promise<BrowserRun> {
    // The first contract stores only a stable failure code; raw exit details remain ephemeral.
    void exit;
    const initialRun = await this.runs.findById(runId);
    if (initialRun === null) {
      throw new BrowserRunNotFoundError(runId);
    }

    return this.mutex.runExclusive(initialRun.profileId, async () => {
      const currentRun = await this.runs.findById(runId);
      if (currentRun === null) {
        throw new BrowserRunNotFoundError(runId);
      }
      if (this.shutdownFinalized) return currentRun;

      if (isBrowserRunTerminal(currentRun.status)) {
        this.unregisterHandle(runId);
        return currentRun;
      }

      const expected = this.expectedStops.has(runId);
      const cleanup = this.cleanupStops.has(runId);
      const nextStatus: BrowserRunStatus = expected && !cleanup ? "stopped" : "failed";
      const updated = await this.saveStatus(currentRun, nextStatus, {
        failureCode: cleanup
          ? currentRun.failureCode
          : expected
            ? null
            : "RUNTIME_UNEXPECTED_EXIT",
      });
      this.unregisterHandle(runId);
      this.expectedStops.delete(runId);
      this.cleanupStops.delete(runId);
      return updated;
    });
  }

  private schedule(operation: () => Promise<void>): void {
    if (this.shutdownFinalized) return;
    const task = Promise.resolve().then(operation);
    this.track(task);
  }

  private track(task: Promise<void>): void {
    if (this.shutdownFinalized) return;
    this.backgroundTasks.add(task);

    const onSuccess = (): void => {
      this.backgroundTasks.delete(task);
    };
    const onError = (error: unknown): void => {
      this.backgroundTasks.delete(task);
      this.eventErrors.push(error);
    };

    task.then(onSuccess, onError);
  }

  private async performLaunch(
    run: BrowserRun,
    input: RuntimeLaunchInput,
  ): Promise<void> {
    const launchPromise = Promise.resolve().then(() => {
      if (this.shutdownFinalized) {
        throw new Error("Browser lifecycle is shutting down");
      }
      return this.runtime.launch(input);
    });
    const outcome = await settleWithin(launchPromise, this.launchTimeoutMs);
    if (this.shutdownFinalized) return;
    if (outcome.kind === "timed_out") {
      await this.updateRun(run, "recovery_required", {
        failureCode: "RUNTIME_LAUNCH_TIMEOUT",
      });
      this.track(
        launchPromise.then(
          (late) => this.completeLateLaunch(run, late),
          () => undefined,
        ),
      );
      return;
    }
    if (outcome.kind === "rejected") {
      await this.updateRun(run, "recovery_required", {
        failureCode: "RUNTIME_LAUNCH_STATE_UNKNOWN",
      });
      return;
    }
    await this.completeLaunch(run, outcome.value);
  }

  private async recoverPersistedRun(run: BrowserRun): Promise<BrowserRun> {
    return this.mutex.runExclusive(run.profileId, async () => {
      const current = await this.requireRun(run.id);
      if (
        current.status !== "starting" &&
        current.status !== "running" &&
        current.status !== "recovery_required"
      ) {
        return current;
      }

      const recoveryInput: RuntimeRecoveryInput = {
        runId: current.id,
        profileId: current.profileId,
        processPid: current.processPid,
        processIdentity: current.processIdentity,
      };
      const outcome = await settleWithin(
        Promise.resolve().then((): Promise<RuntimeRecoveryResult> =>
          this.runtime.recover(recoveryInput),
        ),
        this.recoveryTimeoutMs,
      );
      if (outcome.kind === "timed_out") {
        return this.saveStatus(current, "recovery_required", {
          failureCode: "RUNTIME_RECOVERY_TIMEOUT",
        });
      }
      if (outcome.kind === "rejected") {
        return this.saveStatus(current, "recovery_required", {
          failureCode: "RUNTIME_RECOVERY_LOOKUP_FAILED",
        });
      }

      const recovery = outcome.value;
      if (recovery.status === "unknown") {
        return this.saveStatus(current, "recovery_required", {
          failureCode: recovery.failureCode,
        });
      }
      if (recovery.status === "absent") {
        return this.saveStatus(current, "failed", {
          failureCode: "RUNTIME_PROCESS_NOT_FOUND_DURING_RECOVERY",
        });
      }
      if (recovery.status === "exited") {
        return this.saveStatus(current, "failed", {
          failureCode: "RUNTIME_EXIT_DURING_RECOVERY",
        });
      }
      if (
        (current.processPid !== null && recovery.process.pid !== current.processPid) ||
        (current.processIdentity !== null &&
          recovery.process.processIdentity !== current.processIdentity)
      ) {
        return this.saveStatus(current, "recovery_required", {
          failureCode: "RUNTIME_PROCESS_IDENTITY_MISMATCH",
        });
      }

      if (!this.handles.has(current.id)) {
        this.registerHandle(current.id, recovery.process);
      }
      if (
        current.status !== "running" ||
        current.processPid !== recovery.process.pid ||
        current.processIdentity !== recovery.process.processIdentity ||
        current.failureCode !== null
      ) {
        return this.saveStatus(current, "running", {
          processPid: recovery.process.pid,
          processIdentity: recovery.process.processIdentity,
          failureCode: null,
        });
      }
      return current;
    });
  }

  private async completeLaunch(
    run: BrowserRun,
    launch: RuntimeLaunchResult,
  ): Promise<void> {
    if (this.shutdownFinalized) return;
    if (launch.status === "failed_before_spawn") {
      await this.updateRun(run, "failed", { failureCode: launch.failureCode });
      return;
    }

    if (launch.status === "spawn_uncertain") {
      if (launch.process === null) {
        await this.updateRun(run, "recovery_required", {
          failureCode: "RUNTIME_RECOVERY_REQUIRED",
        });
        return;
      }
      await this.cleanupUncertainProcess(run, launch.process, launch.failureCode);
      return;
    }

    await this.mutex.runExclusive(run.profileId, async () => {
      const current = await this.requireRun(run.id);
      if (this.shutdownFinalized || current.status !== "starting") return;
      this.registerHandle(run.id, launch.process);
      await this.saveStatus(current, "running", {
        processPid: launch.process.pid,
        processIdentity: launch.process.processIdentity,
        failureCode: null,
      });
    });
  }

  private async completeLateLaunch(
    run: BrowserRun,
    launch: RuntimeLaunchResult,
  ): Promise<void> {
    if (this.shutdownFinalized) return;
    if (launch.status === "failed_before_spawn") {
      await this.updateRun(run, "failed", { failureCode: launch.failureCode });
      return;
    }
    if (launch.process !== null) {
      await this.cleanupUncertainProcess(run, launch.process, "RUNTIME_LAUNCH_TIMEOUT");
    }
  }

  private async cleanupUncertainProcess(
    run: BrowserRun,
    process: RuntimeProcess,
    failureCode: string,
  ): Promise<void> {
    if (this.shutdownFinalized) return;
    await this.mutex.runExclusive(run.profileId, async () => {
      const current = await this.requireRun(run.id);
      if (this.shutdownFinalized || isBrowserRunTerminal(current.status)) return;
      this.registerHandle(run.id, process);
      this.expectedStops.add(run.id);
      this.cleanupStops.add(run.id);
      await this.saveStatus(current, "recovery_required", {
        processPid: process.pid,
        processIdentity: process.processIdentity,
        failureCode,
      });
    });

    if (this.shutdownFinalized) return;

    const stopPromise = Promise.resolve().then(() => {
      if (this.shutdownFinalized) {
        throw new Error("Browser lifecycle is shutting down");
      }
      return this.runtime.stop(process, { timeoutMs: this.stopTimeoutMs });
    });
    const outcome = await settleWithin(stopPromise, this.stopTimeoutMs);
    if (this.shutdownFinalized) return;
    if (outcome.kind === "timed_out") {
      await this.updateRun(run, "recovery_required", {
        failureCode: "RUNTIME_STOP_TIMEOUT",
      });
      this.track(
        stopPromise.then(
          (late) => this.completeCleanup(run, late, failureCode),
          () => undefined,
        ),
      );
      return;
    }
    if (outcome.kind === "rejected") {
      await this.updateRun(run, "recovery_required", {
        failureCode: "RUNTIME_STOP_STATE_UNKNOWN",
      });
      return;
    }
    await this.completeCleanup(run, outcome.value, failureCode);
  }

  private async completeCleanup(
    run: BrowserRun,
    result: RuntimeStopResult,
    failureCode: string,
  ): Promise<void> {
    if (this.shutdownFinalized) return;
    if (result.status !== "stopped") {
      await this.updateRun(run, "recovery_required", {
        failureCode: result.failureCode,
      });
      return;
    }
    await this.updateRun(run, "failed", { failureCode });
    this.unregisterHandle(run.id);
    this.expectedStops.delete(run.id);
    this.cleanupStops.delete(run.id);
  }

  private async performStop(run: BrowserRun, process: RuntimeProcess): Promise<void> {
    const stopPromise = Promise.resolve().then(() => {
      if (this.shutdownFinalized) {
        throw new Error("Browser lifecycle is shutting down");
      }
      return this.runtime.stop(process, { timeoutMs: this.stopTimeoutMs });
    });
    const outcome = await settleWithin(stopPromise, this.stopTimeoutMs);
    if (this.shutdownFinalized) return;
    if (outcome.kind === "timed_out") {
      await this.updateRun(run, "recovery_required", {
        failureCode: "RUNTIME_STOP_TIMEOUT",
      });
      this.track(
        stopPromise.then(
          (late) => this.completeStop(run, late),
          () => undefined,
        ),
      );
      return;
    }
    if (outcome.kind === "rejected") {
      await this.updateRun(run, "recovery_required", {
        failureCode: "RUNTIME_STOP_STATE_UNKNOWN",
      });
      return;
    }
    await this.completeStop(run, outcome.value);
  }

  private async completeStop(
    run: BrowserRun,
    result: RuntimeStopResult,
  ): Promise<void> {
    if (this.shutdownFinalized) return;
    if (result.status !== "stopped") {
      await this.updateRun(run, "recovery_required", {
        failureCode: result.failureCode,
      });
      return;
    }
    await this.updateRun(run, "stopped", { failureCode: null });
    this.unregisterHandle(run.id);
    this.expectedStops.delete(run.id);
  }

  private async requireRun(runId: string): Promise<BrowserRun> {
    const run = await this.runs.findById(runId);
    if (run === null) throw new BrowserRunNotFoundError(runId);
    return run;
  }

  private async updateRun(
    run: BrowserRun,
    status: BrowserRunStatus,
    patch: Partial<Pick<BrowserRun, "failureCode" | "processPid" | "processIdentity">>,
  ): Promise<BrowserRun> {
    if (this.shutdownFinalized) return run;
    return this.mutex.runExclusive(run.profileId, async () => {
      const current = await this.requireRun(run.id);
      return isBrowserRunTerminal(current.status)
        ? current
        : this.saveStatus(current, status, patch);
    });
  }

  private registerHandle(runId: string, process: RuntimeProcess): void {
    if (this.shutdownFinalized) return;
    const unsubscribe = process.onExit((exit) => {
      if (this.shutdownFinalized) return;
      queueMicrotask(() => {
        if (this.shutdownFinalized) return;
        this.track(
          this.handleExit(runId, exit).then(
            () => undefined,
            (error: unknown) => {
              this.eventErrors.push(error);
            },
          ),
        );
      });
    });
    this.handles.set(runId, { process, unsubscribe });
  }

  private unregisterHandle(runId: string): void {
    const handle = this.handles.get(runId);
    if (handle === undefined) {
      return;
    }

    handle.unsubscribe();
    this.handles.delete(runId);
  }

  private async saveStatus(
    run: BrowserRun,
    status: BrowserRunStatus,
    patch: Partial<Pick<BrowserRun, "failureCode" | "processPid" | "processIdentity">>,
  ): Promise<BrowserRun> {
    if (this.shutdownFinalized) return run;
    const nextStatus = transitionBrowserRun(run.status, status);
    if (nextStatus === run.status && Object.keys(patch).length === 0) {
      return run;
    }

    const timestamp = this.now();
    return this.runs.save({
      ...run,
      ...patch,
      status: nextStatus,
      updatedAt: timestamp,
      endedAt: isBrowserRunTerminal(nextStatus) ? (run.endedAt ?? timestamp) : null,
    });
  }

  private assertAcceptingCommands(): void {
    if (this.shutdownRequested) {
      throw new Error("Browser lifecycle is shutting down");
    }
  }

  private async drainForShutdown(): Promise<void> {
    this.shutdownRequested = true;
    const drained = await this.drainBackgroundTasks();
    const failureCode = drained
      ? "RUNTIME_SHUTDOWN_STATE_UNKNOWN"
      : "RUNTIME_SHUTDOWN_TIMEOUT";
    const occupyingRuns = await this.runs.listOccupying();

    for (const run of occupyingRuns) {
      if (run.status !== "starting" && run.status !== "stopping") continue;
      await this.mutex.runExclusive(run.profileId, async () => {
        const current = await this.requireRun(run.id);
        if (current.status !== "starting" && current.status !== "stopping") return;
        await this.saveStatus(current, "recovery_required", { failureCode });
      });
    }

    this.shutdownFinalized = true;
    for (const runId of [...this.handles.keys()]) {
      this.unregisterHandle(runId);
    }
  }

  private async drainBackgroundTasks(): Promise<boolean> {
    const deadline = Date.now() + this.shutdownTimeoutMs;

    while (this.backgroundTasks.size > 0) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return false;

      const pending = [...this.backgroundTasks];
      const outcome = await settleWithin(
        Promise.allSettled(pending).then(() => undefined),
        remainingMs,
      );
      if (outcome.kind === "timed_out") return false;
    }

    return true;
  }
}
