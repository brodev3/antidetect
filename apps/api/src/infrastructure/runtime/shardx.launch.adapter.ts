import type { ChildProcess } from "node:child_process";
import { isIP } from "node:net";
import { win32 } from "node:path";
import type {
  BrowserSession,
  ShardX,
  ShardXLaunchOptions,
  Profile,
} from "@proxyshard/shardx";
import { z } from "zod";
import type { BrowserRunRepository } from "../../application/browserRuns/browser.run.repository.js";
import type { FingerprintIdentityRepository } from "../../application/fingerprints/fingerprint.identity.repository.js";
import type {
  RuntimeExit,
  RuntimeExitListener,
  RuntimeLaunchInput,
  RuntimeLaunchResult,
  RuntimeProcess,
  RuntimeStopOptions,
  RuntimeStopResult,
} from "../../application/runtime/browser.runtime.js";
import type { AppPaths } from "../../config/app.paths.js";
import {
  ShardXLaunchPreparer,
  type ShardXLaunchPreparationResult,
} from "./shardx.launch.preparation.js";
import {
  identifyShardXProcess,
  type ShardXProcessIdentityExpectation,
  type ShardXProcessInventory,
  type ShardXProcessIdentityResult,
} from "./shardx.process.identity.js";
import { createShardXSdk } from "./shardx.sdk.js";
import {
  readShardXWindowsProcessInventory,
  type ShardXWindowsProcessInventoryRequest,
  type ShardXWindowsProcessInventoryResult,
} from "./shardx.windows.process.inventory.js";

interface LaunchSdk extends Pick<ShardX, "listProfiles"> {
  readonly runtime: Pick<ShardX["runtime"], "binaryPath">;
  launch(
    profile: Profile,
    options: Readonly<ShardXLaunchOptions>,
  ): Promise<Pick<BrowserSession, "pid" | "userDataDir" | "process" | "cdpUrl">>;
}

type InventoryReader = (
  request: ShardXWindowsProcessInventoryRequest,
) => Promise<ShardXWindowsProcessInventoryResult>;

type BrowserCloseClient = (cdpUrl: string, signal: AbortSignal) => Promise<void>;

interface ActiveProcess {
  readonly process: RuntimeProcess;
  readonly expected: BoundProcessIdentity;
  readonly cdpUrl: string | null;
  readonly observer: LaunchedProcessObserver;
  stopPromise: Promise<RuntimeStopResult> | null;
}

export interface ShardXLaunchAdapterDependencies {
  readonly runs: Pick<BrowserRunRepository, "findById">;
  readonly identities: Pick<FingerprintIdentityRepository, "findById">;
  readonly sdk?: LaunchSdk;
  readonly preparer?: Pick<ShardXLaunchPreparer, "prepareStored">;
  readonly readInventory?: InventoryReader;
  readonly closeBrowser?: BrowserCloseClient;
}

type InspectionResult =
  | ShardXProcessIdentityResult
  | {
      readonly status: "unavailable";
      readonly failureCode: "RUNTIME_PROCESS_SCAN_UNAVAILABLE";
    };

type BoundProcessIdentity = ShardXProcessIdentityExpectation & {
  readonly processPid: number;
  readonly processIdentity: string;
};

function uncertain(
  failureCode: string,
  process: RuntimeProcess | null = null,
): RuntimeLaunchResult {
  return { status: "spawn_uncertain", failureCode, process };
}

function failedStop(failureCode: string): RuntimeStopResult {
  return { status: "failed", failureCode, exit: null };
}

function timedOutStop(): RuntimeStopResult {
  return { status: "timed_out", failureCode: "RUNTIME_STOP_TIMEOUT", exit: null };
}

function isLoopbackHost(hostname: string): boolean {
  const address = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(address) === 4) return address.startsWith("127.");
  return address === "::1" || address.startsWith("::ffff:127.");
}

function validatedCdpUrl(value: string | null, port: number | null): string | null {
  if (value === null || port === null) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "ws:" ||
      !isLoopbackHost(url.hostname) ||
      Number(url.port) !== port ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !url.pathname.startsWith("/devtools/browser/")
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function closeBrowserOverCdp(cdpUrl: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (typeof globalThis.WebSocket !== "function") {
      reject(new Error("WebSocket is unavailable"));
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(cdpUrl);
    } catch {
      reject(new Error("CDP connection failed"));
      return;
    }

    let settled = false;
    const cleanup = (): void => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close();
        }
      } catch {
        // The browser may close the CDP socket as part of Browser.close.
      }
      if (error === undefined) resolve();
      else reject(error);
    };
    const onOpen = (): void => {
      try {
        socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      } catch {
        finish(new Error("CDP command failed"));
      }
    };
    const onMessage = (event: MessageEvent): void => {
      if (typeof event.data !== "string") {
        finish(new Error("Invalid CDP response"));
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        finish(new Error("Invalid CDP response"));
        return;
      }
      if (typeof payload !== "object" || payload === null || !("id" in payload)) return;
      const response = payload as { id: unknown; error?: unknown; result?: unknown };
      if (response.id !== 1) return;
      if (
        response.error !== undefined ||
        typeof response.result !== "object" ||
        response.result === null
      ) {
        finish(new Error("CDP command was rejected"));
        return;
      }
      finish();
    };
    const onError = (): void => finish(new Error("CDP connection failed"));
    const onClose = (): void =>
      finish(new Error("CDP closed before acknowledging Browser.close"));
    const onAbort = (): void => finish(new Error("CDP command timed out"));

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

/** Isolated ShardX launch/stop step; it is not wired into the normal API. */
export class ShardXLaunchAdapter {
  private readonly sdk: LaunchSdk;
  private readonly preparer: Pick<ShardXLaunchPreparer, "prepareStored">;
  private readonly readInventory: InventoryReader;
  private readonly pendingProfiles = new Set<string>();
  private readonly profilesDirectory: string;
  private readonly closeBrowser: BrowserCloseClient;
  private readonly activeProcesses = new WeakMap<RuntimeProcess, ActiveProcess>();

  constructor(
    paths: Pick<AppPaths, "runtimeDir" | "profilesDir">,
    private readonly dependencies: ShardXLaunchAdapterDependencies,
  ) {
    this.sdk = dependencies.sdk ?? createShardXSdk(paths);
    this.preparer = dependencies.preparer ?? new ShardXLaunchPreparer(paths, this.sdk);
    this.readInventory =
      dependencies.readInventory ?? readShardXWindowsProcessInventory;
    this.closeBrowser = dependencies.closeBrowser ?? closeBrowserOverCdp;
    this.profilesDirectory = paths.profilesDir;
  }

  stop(
    process: RuntimeProcess,
    options: RuntimeStopOptions,
  ): Promise<RuntimeStopResult> {
    const active = this.activeProcesses.get(process);
    if (
      active === undefined ||
      process.runtimeId !== active.process.runtimeId ||
      process.pid !== active.process.pid ||
      process.processIdentity !== active.process.processIdentity
    ) {
      return Promise.resolve(failedStop("RUNTIME_PROCESS_IDENTITY_UNVERIFIED"));
    }
    if (active.observer.confirmedExit !== null) {
      const confirmedStop: Promise<RuntimeStopResult> = Promise.resolve({
        status: "stopped",
        exit: active.observer.confirmedExit,
      });
      active.stopPromise = confirmedStop;
      return confirmedStop;
    }
    if (active.stopPromise !== null) return active.stopPromise;
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      return Promise.resolve(timedOutStop());
    }

    const controller = new AbortController();
    const deadlineAt = Date.now() + options.timeoutMs;
    const operation = this.performStop(active, controller.signal, deadlineAt).catch(
      () => failedStop("RUNTIME_STOP_STATE_UNKNOWN"),
    );
    const stopPromiseRef: { current: Promise<RuntimeStopResult> | null } = {
      current: null,
    };
    const operationWithState = operation.then((result) => {
      if (
        stopPromiseRef.current !== null &&
        active.stopPromise === stopPromiseRef.current
      ) {
        active.stopPromise =
          result.status === "stopped" ? Promise.resolve(result) : null;
      }
      return result;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<RuntimeStopResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(timedOutStop());
      }, options.timeoutMs);
    });
    const stopPromise = Promise.race([operationWithState, deadline]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
    stopPromiseRef.current = stopPromise;
    active.stopPromise = stopPromise;
    return stopPromise;
  }

  private async performStop(
    active: ActiveProcess,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<RuntimeStopResult> {
    // The session's SDK stop() may escalate from SIGTERM to SIGKILL. Keep
    // ownership verification and shutdown on the explicit CDP path instead.
    const before = await this.inspectWithInventory(active.expected);
    if (signal.aborted) return timedOutStop();
    if (before.identity.status === "absent") {
      return {
        status: "stopped",
        exit: active.observer.confirmVerifiedAbsence(),
      };
    }
    if (before.identity.status !== "matched" || before.inventory === null) {
      return failedStop(
        before.identity.status === "unavailable"
          ? before.identity.failureCode
          : "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
      );
    }

    const cdpUrl = validatedCdpUrl(active.cdpUrl, before.inventory.cdpPort);
    if (cdpUrl === null) return failedStop("RUNTIME_PROCESS_IDENTITY_UNVERIFIED");
    try {
      await this.closeBrowser(cdpUrl, signal);
    } catch {
      return signal.aborted ? timedOutStop() : failedStop("RUNTIME_CDP_CLOSE_FAILED");
    }
    if (signal.aborted) return timedOutStop();
    active.observer.markGracefulCloseAcknowledged();

    let delayMs = 100;
    while (!signal.aborted) {
      const snapshot = await this.inspectWithInventory(active.expected);
      if (signal.aborted) return timedOutStop();
      if (snapshot.identity.status === "absent") {
        return {
          status: "stopped",
          exit: active.observer.confirmVerifiedAbsence(),
        };
      }
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) return timedOutStop();
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, Math.min(delayMs, remainingMs));
        timer.unref?.();
      });
      delayMs = Math.min(delayMs * 2, 2000);
    }
    return timedOutStop();
  }

  async launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
    const snapshot: RuntimeLaunchInput = {
      runId: input.runId,
      profileId: input.profileId,
      profileDirectory: input.profileDirectory,
      identityRef: input.identityRef,
    };
    if (
      !z.uuid().safeParse(snapshot.runId).success ||
      !z.uuid().safeParse(snapshot.profileId).success
    ) {
      return {
        status: "failed_before_spawn",
        failureCode: "RUNTIME_LAUNCH_INPUT_INVALID",
      };
    }
    if (this.pendingProfiles.has(snapshot.profileId)) {
      return uncertain("RUNTIME_LAUNCH_STATE_UNKNOWN");
    }
    this.pendingProfiles.add(snapshot.profileId);
    try {
      return await this.performLaunch(snapshot);
    } finally {
      this.pendingProfiles.delete(snapshot.profileId);
    }
  }

  private async performLaunch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
    let runCreatedAt: string;
    try {
      const run = await this.dependencies.runs.findById(input.runId);
      if (
        run === null ||
        run.id !== input.runId ||
        run.profileId !== input.profileId ||
        run.status !== "starting" ||
        run.endedAt !== null ||
        !z.iso.datetime().safeParse(run.createdAt).success
      ) {
        return {
          status: "failed_before_spawn",
          failureCode: "RUNTIME_RUN_METADATA_UNAVAILABLE",
        };
      }
      if (run.processPid !== null || run.processIdentity !== null) {
        return uncertain("RUNTIME_PROCESS_IDENTITY_UNVERIFIED");
      }
      runCreatedAt = run.createdAt;
    } catch {
      return {
        status: "failed_before_spawn",
        failureCode: "RUNTIME_RUN_METADATA_UNAVAILABLE",
      };
    }

    const preparation = await this.prepare(input);
    if (preparation.status !== "prepared") return preparation;
    const expected: ShardXProcessIdentityExpectation = {
      executablePath: this.sdk.runtime.binaryPath,
      profileDirectory: input.profileDirectory,
      runCreatedAt,
      processPid: null,
      processIdentity: null,
    };

    // Do not overwrite a live profile's fingerprint file or ask the SDK to
    // attach to an existing browser. Uncertainty preserves durable occupancy.
    const beforeLaunch = await this.inspect(expected);
    if (beforeLaunch.status !== "absent") {
      return uncertain(
        beforeLaunch.status === "unavailable"
          ? beforeLaunch.failureCode
          : "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
      );
    }

    let session: Pick<BrowserSession, "pid" | "userDataDir" | "process" | "cdpUrl">;
    try {
      session = await this.sdk.launch(preparation.profile, {
        ...preparation.options,
        // The pinned SDK appends profile.id to this option. Preparation stores
        // our final directory, but the vendor call must receive its parent root.
        userDataDir: this.profilesDirectory,
      });
    } catch {
      // Rejection is not proof that no child was spawned. Never retry here.
      return uncertain("RUNTIME_LAUNCH_STATE_UNKNOWN");
    }
    try {
      if (
        !Number.isSafeInteger(session.pid) ||
        session.pid <= 0 ||
        session.process.pid !== session.pid ||
        win32.normalize(session.userDataDir).toLowerCase() !==
          win32.normalize(input.profileDirectory).toLowerCase()
      ) {
        return uncertain("RUNTIME_PROCESS_IDENTITY_UNVERIFIED");
      }
    } catch {
      return uncertain("RUNTIME_PROCESS_IDENTITY_UNVERIFIED");
    }

    const observer = new LaunchedProcessObserver(session.process, (identity) =>
      this.inspect(identity),
    );
    const inspected = await this.inspectWithInventory({
      ...expected,
      processPid: session.pid,
    });
    const identity = inspected.identity;
    if (identity.status !== "matched") {
      observer.dispose();
      return uncertain(
        identity.status === "unavailable"
          ? identity.failureCode
          : "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
      );
    }
    // A dead SDK child cannot authenticate a later process that reused its PID.
    if (observer.rootExited) {
      observer.dispose();
      return uncertain("RUNTIME_LAUNCH_STATE_UNKNOWN");
    }
    const process = observer.bind(input.runId, {
      ...expected,
      processPid: identity.pid,
      processIdentity: identity.processIdentity,
    });
    this.activeProcesses.set(process, {
      process,
      expected: {
        ...expected,
        processPid: identity.pid,
        processIdentity: identity.processIdentity,
      },
      cdpUrl: session.cdpUrl,
      observer,
      stopPromise: null,
    });
    if (observer.processErrored)
      return uncertain("RUNTIME_LAUNCH_STATE_UNKNOWN", process);
    if (
      validatedCdpUrl(session.cdpUrl, inspected.inventory?.cdpPort ?? null) === null
    ) {
      return uncertain("RUNTIME_PROCESS_IDENTITY_UNVERIFIED", process);
    }
    return { status: "started", process };
  }

  private async prepare(
    input: RuntimeLaunchInput,
  ): Promise<ShardXLaunchPreparationResult> {
    try {
      return await this.preparer.prepareStored(input, this.dependencies.identities);
    } catch {
      return {
        status: "failed_before_spawn",
        failureCode: "RUNTIME_PREPARATION_FAILED",
      } as const;
    }
  }

  private async inspect(
    expected: ShardXProcessIdentityExpectation,
  ): Promise<InspectionResult> {
    return (await this.inspectWithInventory(expected)).identity;
  }

  private async inspectWithInventory(
    expected: ShardXProcessIdentityExpectation,
  ): Promise<{
    readonly identity: InspectionResult;
    readonly inventory: ShardXProcessInventory | null;
  }> {
    try {
      const result = await this.readInventory({
        executablePath: expected.executablePath,
        profileDirectory: expected.profileDirectory,
        // Called before SDK launch or after its promise has settled; the
        // per-profile guard excludes another launcher in this adapter.
        pendingLauncher: "none",
      });
      return result.status === "available"
        ? {
            identity: identifyShardXProcess(expected, result.inventory),
            inventory: result.inventory,
          }
        : { identity: result, inventory: null };
    } catch {
      return {
        identity: {
          status: "unavailable",
          failureCode: "RUNTIME_PROCESS_SCAN_UNAVAILABLE",
        },
        inventory: null,
      };
    }
  }
}

/** Buffers early exit and only publishes exit after a complete absence check. */
class LaunchedProcessObserver {
  rootExited: boolean;
  processErrored = false;
  private code: number | null;
  private signal: NodeJS.Signals | null;
  private expected: ShardXProcessIdentityExpectation | null = null;
  private verificationStarted = false;
  private readonly listeners = new Set<RuntimeExitListener>();
  private gracefulCloseAcknowledged = false;

  get confirmedExit(): RuntimeExit | null {
    return this.confirmedExitValue;
  }

  private confirmedExitValue: RuntimeExit | null = null;

  constructor(
    private readonly child: ChildProcess,
    private readonly inspect: (
      expected: ShardXProcessIdentityExpectation,
    ) => Promise<InspectionResult>,
  ) {
    this.code = child.exitCode;
    this.signal = child.signalCode;
    this.rootExited = child.exitCode !== null || child.signalCode !== null;
    child.once("exit", this.captureExit);
    child.on("error", this.captureError);
  }

  private readonly captureError = (): void => {
    this.processErrored = true;
  };

  private readonly captureExit = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    this.rootExited = true;
    this.code = code;
    this.signal = signal;
    this.startVerification();
  };

  bind(runId: string, expected: BoundProcessIdentity): RuntimeProcess {
    this.expected = expected;
    this.startVerification();
    return {
      runtimeId: `${runId}:shardx`,
      pid: expected.processPid,
      processIdentity: expected.processIdentity,
      onExit: (listener) => {
        if (this.confirmedExit !== null) {
          listener(this.confirmedExit);
          return () => undefined;
        }
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
    };
  }

  markGracefulCloseAcknowledged(): void {
    this.gracefulCloseAcknowledged = true;
  }

  confirmVerifiedAbsence(): RuntimeExit {
    this.rootExited = true;
    this.code = this.child.exitCode ?? this.code;
    this.signal = this.child.signalCode ?? this.signal;
    const exit = this.classifyExit();
    this.publishConfirmedExit(exit);
    return this.confirmedExitValue ?? exit;
  }

  dispose(): void {
    this.child.removeListener("exit", this.captureExit);
    this.child.removeListener("error", this.captureError);
  }

  private startVerification(): void {
    if (!this.rootExited || this.expected === null || this.verificationStarted) return;
    this.verificationStarted = true;
    const verification = this.verifyExit(this.expected);
    void verification
      .then(
        (exit) => {
          if (exit === null) return;
          this.publishConfirmedExit(exit);
        },
        () => {
          console.error("RUNTIME_EXIT_VERIFICATION_FAILED");
        },
      )
      .catch(() => {
        console.error("RUNTIME_EXIT_LISTENER_FAILED");
      });
  }

  private async verifyExit(
    expected: ShardXProcessIdentityExpectation,
  ): Promise<RuntimeExit | null> {
    // Root exit can precede child-process exit. Check three times, then leave
    // occupancy unchanged for a later recovery operation; never poll forever.
    for (const waitMs of [0, 100, 250]) {
      if (waitMs !== 0) {
        await new Promise<void>((resolveWait) => {
          const timer = setTimeout(resolveWait, waitMs);
          timer.unref();
        });
      }
      const result = await this.inspect(expected);
      if (result.status === "absent") {
        return this.classifyExit();
      }
    }
    return null;
  }

  private classifyExit(): RuntimeExit {
    return {
      kind:
        this.signal !== null || (this.code !== null && this.code !== 0)
          ? "abnormal"
          : this.gracefulCloseAcknowledged
            ? "normal"
            : "unknown",
      code: this.code,
      signal: this.signal,
    };
  }

  private publishConfirmedExit(exit: RuntimeExit): void {
    if (this.confirmedExitValue !== null) return;
    this.confirmedExitValue = exit;
    this.dispose();
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) {
      try {
        listener(exit);
      } catch {
        console.error("RUNTIME_EXIT_LISTENER_FAILED");
      }
    }
  }
}
