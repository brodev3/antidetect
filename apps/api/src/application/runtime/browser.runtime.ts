/**
 * Application-owned port for controlling a browser process.
 * Vendor SDK types must not cross this boundary.
 */
export interface RuntimeLaunchInput {
  readonly runId: string;
  readonly profileId: string;
  readonly profileDirectory: string;
  readonly identityRef: string | null;
}

export interface RuntimeExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export type RuntimeExitListener = (exit: RuntimeExit) => void;

export interface RuntimeProcess {
  readonly runtimeId: string;
  readonly pid: number | null;
  /**
   * Opaque, durable adapter identity. It should capture process creation time,
   * canonical executable path, and profile directory, and must be revalidated
   * against the live process. This value is correlation data, not a credential.
   */
  readonly processIdentity: string;
  onExit(listener: RuntimeExitListener): () => void;
}

export interface RuntimeLaunchSuccess {
  readonly status: "started";
  readonly process: RuntimeProcess;
}

export interface RuntimeLaunchFailedBeforeSpawn {
  readonly status: "failed_before_spawn";
  readonly failureCode: string;
}

export interface RuntimeLaunchSpawnUncertain {
  readonly status: "spawn_uncertain";
  readonly failureCode: string;
  readonly process: RuntimeProcess | null;
}

export type RuntimeLaunchResult =
  RuntimeLaunchSuccess | RuntimeLaunchFailedBeforeSpawn | RuntimeLaunchSpawnUncertain;

export interface RuntimeStopOptions {
  readonly timeoutMs: number;
}

export interface RuntimeStopSuccess {
  readonly status: "stopped";
  readonly exit: RuntimeExit;
}

export interface RuntimeStopTimedOut {
  readonly status: "timed_out";
  readonly failureCode: "RUNTIME_STOP_TIMEOUT";
  readonly exit: null;
}

export interface RuntimeStopFailed {
  readonly status: "failed";
  readonly failureCode: string;
  readonly exit: null;
}

export type RuntimeStopResult =
  RuntimeStopSuccess | RuntimeStopTimedOut | RuntimeStopFailed;

export interface RuntimeRecoveryInput {
  /** Persisted before launch so recovery can find a process without PID metadata. */
  readonly runId: string;
  readonly profileId: string;
  readonly processPid: number | null;
  readonly processIdentity: string | null;
}

export interface RuntimeRecoveryAttached {
  readonly status: "attached";
  readonly process: RuntimeProcess;
}

export interface RuntimeRecoveryExited {
  readonly status: "exited";
  readonly exit: RuntimeExit;
}

/** The adapter conclusively found no live process or pending launcher for this run. */
export interface RuntimeRecoveryAbsent {
  readonly status: "absent";
}

export interface RuntimeRecoveryUnknown {
  readonly status: "unknown";
  readonly failureCode: string;
}

export type RuntimeRecoveryResult =
  | RuntimeRecoveryAttached
  | RuntimeRecoveryExited
  | RuntimeRecoveryAbsent
  | RuntimeRecoveryUnknown;

export interface BrowserRuntime {
  launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult>;
  recover(input: RuntimeRecoveryInput): Promise<RuntimeRecoveryResult>;
  stop(
    process: RuntimeProcess,
    options: RuntimeStopOptions,
  ): Promise<RuntimeStopResult>;
}
