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
} from "../../application/runtime/browser.runtime.js";

export type FakeLaunchPlan =
  | { readonly outcome: "success" }
  | { readonly outcome: "fail-before-spawn"; readonly failureCode?: string }
  | { readonly outcome: "fail-after-spawn"; readonly failureCode?: string };

export type FakeStopPlan =
  | { readonly outcome: "success"; readonly exit?: RuntimeExit }
  | { readonly outcome: "fail"; readonly failureCode?: string }
  | { readonly outcome: "timeout" };

export type FakeRecoveryPlan =
  | { readonly outcome: "absent" }
  | { readonly outcome: "unknown"; readonly failureCode?: string };

export interface FakeBrowserRuntimeOptions {
  readonly launchPlans?: readonly FakeLaunchPlan[];
  readonly recoveryPlans?: readonly FakeRecoveryPlan[];
  readonly stopPlans?: readonly FakeStopPlan[];
  readonly firstPid?: number;
  readonly processHost?: FakeBrowserProcessHost;
}

interface ProcessRecord {
  readonly runId: string;
  readonly profileId: string;
  readonly profileDirectory: string;
  readonly handle: RuntimeProcess;
  readonly listeners: Set<(exit: RuntimeExit) => void>;
  readonly state: { exited: RuntimeExit | null };
}

/** Fake-only process state that survives recreating a BrowserRuntime instance. */
export class FakeBrowserProcessHost {
  private readonly processes = new Map<string, ProcessRecord>();

  findByRunId(runId: string): ProcessRecord | undefined {
    return this.processes.get(runId);
  }

  allProcesses(): readonly ProcessRecord[] {
    return [...this.processes.values()];
  }

  register(record: ProcessRecord): void {
    this.processes.set(record.runId, record);
  }

  /** Models API-process death: OS processes survive, in-process listeners do not. */
  simulateApiProcessExit(): void {
    for (const process of this.processes.values()) {
      process.listeners.clear();
    }
  }
}

function cloneLaunchInput(input: RuntimeLaunchInput): RuntimeLaunchInput {
  return {
    runId: input.runId,
    profileId: input.profileId,
    profileDirectory: input.profileDirectory,
    identityRef: input.identityRef,
  };
}

export class FakeBrowserRuntime implements BrowserRuntime {
  private readonly launchPlans: FakeLaunchPlan[];
  private readonly recoveryPlans: FakeRecoveryPlan[];
  private readonly stopPlans: FakeStopPlan[];
  private readonly processHost: FakeBrowserProcessHost;
  private readonly launchCallLog: RuntimeLaunchInput[] = [];
  private readonly recoveryCallLog: RuntimeRecoveryInput[] = [];
  private readonly stopCallLog: Array<{
    readonly processId: string;
    readonly options: RuntimeStopOptions;
  }> = [];
  private nextProcessNumber = 1;
  private nextPid: number;

  constructor(options: FakeBrowserRuntimeOptions = {}) {
    this.launchPlans = [...(options.launchPlans ?? [])];
    this.recoveryPlans = [...(options.recoveryPlans ?? [])];
    this.stopPlans = [...(options.stopPlans ?? [])];
    this.processHost = options.processHost ?? new FakeBrowserProcessHost();
    this.nextPid = options.firstPid ?? 10_000;
  }

  get launchCalls(): readonly RuntimeLaunchInput[] {
    return this.launchCallLog;
  }

  get stopCalls(): readonly {
    readonly processId: string;
    readonly options: RuntimeStopOptions;
  }[] {
    return this.stopCallLog;
  }

  get recoveryCalls(): readonly RuntimeRecoveryInput[] {
    return this.recoveryCallLog;
  }

  activeProcesses(): readonly RuntimeProcess[] {
    return this.processHost
      .allProcesses()
      .filter((record) => record.state.exited === null)
      .map((record) => record.handle);
  }

  async launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
    this.assertLaunchInput(input);
    this.launchCallLog.push(cloneLaunchInput(input));

    const plan = this.launchPlans.shift() ?? { outcome: "success" as const };
    if (plan.outcome === "fail-before-spawn") {
      return {
        status: "failed_before_spawn",
        failureCode: plan.failureCode ?? "RUNTIME_LAUNCH_FAILED",
      };
    }

    const handle = this.createProcess(input);
    if (plan.outcome === "fail-after-spawn") {
      return {
        status: "spawn_uncertain",
        failureCode: plan.failureCode ?? "RUNTIME_LAUNCH_STATE_UNKNOWN",
        process: handle,
      };
    }

    return { status: "started", process: handle };
  }

  async recover(input: RuntimeRecoveryInput): Promise<RuntimeRecoveryResult> {
    this.recoveryCallLog.push({ ...input });
    const plan = this.recoveryPlans.shift();
    if (plan?.outcome === "absent") {
      return { status: "absent" };
    }
    if (plan?.outcome === "unknown") {
      return {
        status: "unknown",
        failureCode: plan.failureCode ?? "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
      };
    }

    const record = this.processHost.findByRunId(input.runId);
    if (
      record === undefined ||
      record.profileId !== input.profileId ||
      record.profileDirectory !== input.profileDirectory ||
      (input.processPid !== null && record.handle.pid !== input.processPid) ||
      (input.processIdentity !== null &&
        record.handle.processIdentity !== input.processIdentity)
    ) {
      return {
        status: "unknown",
        failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
      };
    }
    if (record.state.exited !== null) {
      return { status: "exited", exit: record.state.exited };
    }

    return { status: "attached", process: record.handle };
  }

  async stop(
    process: RuntimeProcess,
    options: RuntimeStopOptions,
  ): Promise<RuntimeStopResult> {
    const record = this.findProcess(process);
    this.stopCallLog.push({
      processId: process.runtimeId,
      options: { ...options },
    });

    if (record.state.exited !== null) {
      return { status: "stopped", exit: record.state.exited };
    }

    const plan = this.stopPlans.shift() ?? { outcome: "success" as const };
    if (plan.outcome === "fail") {
      return {
        status: "failed",
        failureCode: plan.failureCode ?? "RUNTIME_STOP_FAILED",
        exit: null,
      };
    }
    if (plan.outcome === "timeout") {
      return {
        status: "timed_out",
        failureCode: "RUNTIME_STOP_TIMEOUT",
        exit: null,
      };
    }

    const exit: RuntimeExit = plan.exit ?? { kind: "normal", code: 0, signal: null };
    this.emitExit(record, exit);
    return { status: "stopped", exit };
  }

  emitUnexpectedExit(
    process: RuntimeProcess,
    exit: Omit<RuntimeExit, "kind"> = { code: 1, signal: null },
  ): void {
    this.emitProcessExit(process, { ...exit, kind: "abnormal" });
  }

  emitNormalExit(
    process: RuntimeProcess,
    exit: Omit<RuntimeExit, "kind"> = { code: 0, signal: null },
  ): void {
    this.emitProcessExit(process, { ...exit, kind: "normal" });
  }

  emitUnknownExit(
    process: RuntimeProcess,
    exit: Omit<RuntimeExit, "kind"> = { code: null, signal: null },
  ): void {
    this.emitProcessExit(process, { ...exit, kind: "unknown" });
  }

  private emitProcessExit(process: RuntimeProcess, exit: RuntimeExit): void {
    const record = this.findProcess(process);
    if (record.state.exited !== null) {
      return;
    }

    this.emitExit(record, exit);
  }

  private createProcess(input: RuntimeLaunchInput): RuntimeProcess {
    const sequence = String(this.nextProcessNumber++).padStart(3, "0");
    const runtimeId = `${input.runId}:fake-process-${sequence}`;
    const state = { exited: null as RuntimeExit | null };
    const listeners = new Set<(exit: RuntimeExit) => void>();
    const handle: RuntimeProcess = {
      runtimeId,
      pid: this.nextPid++,
      processIdentity: `${input.profileId}:${runtimeId}`,
      onExit: (listener) => {
        if (state.exited !== null) {
          listener(state.exited);
          return () => undefined;
        }

        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const record: ProcessRecord = {
      runId: input.runId,
      profileId: input.profileId,
      profileDirectory: input.profileDirectory,
      handle,
      listeners,
      state,
    };
    this.processHost.register(record);
    return handle;
  }

  private emitExit(record: ProcessRecord, exit: RuntimeExit): void {
    record.state.exited = exit;
    const listeners = [...record.listeners];
    record.listeners.clear();
    for (const listener of listeners) {
      listener(exit);
    }
  }

  private findProcess(process: RuntimeProcess): ProcessRecord {
    const record = this.processHost
      .allProcesses()
      .find((candidate) => candidate.handle.runtimeId === process.runtimeId);
    if (record === undefined || record.handle !== process) {
      throw new Error(`Unknown fake runtime process: ${process.runtimeId}`);
    }
    return record;
  }

  private assertLaunchInput(input: RuntimeLaunchInput): void {
    for (const [name, value] of Object.entries(input).filter(
      ([name]) => name !== "identityRef",
    )) {
      if (value.trim().length === 0) {
        throw new TypeError(`${name} must not be empty`);
      }
    }
    if (input.identityRef !== null && input.identityRef.trim().length === 0) {
      throw new TypeError("identityRef must not be empty when provided");
    }
  }
}
