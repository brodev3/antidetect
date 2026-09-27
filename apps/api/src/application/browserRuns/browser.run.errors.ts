import type { BrowserRunStatus } from "./browser.run.state.js";

export class InvalidBrowserRunTransitionError extends Error {
  readonly code = "INVALID_BROWSER_RUN_TRANSITION" as const;

  constructor(
    readonly from: BrowserRunStatus,
    readonly to: BrowserRunStatus,
  ) {
    super(`Cannot transition browser run from ${from} to ${to}`);
    this.name = "InvalidBrowserRunTransitionError";
  }
}

export class BrowserRunNotFoundError extends Error {
  readonly code = "BROWSER_RUN_NOT_FOUND" as const;

  constructor(readonly runId: string) {
    super(`Browser run ${runId} was not found`);
    this.name = "BrowserRunNotFoundError";
  }
}

export class ActiveBrowserRunConflictError extends Error {
  readonly code = "ACTIVE_BROWSER_RUN_CONFLICT" as const;

  constructor(
    readonly profileId: string,
    readonly activeRunId: string,
  ) {
    super(`Profile ${profileId} already has active browser run ${activeRunId}`);
    this.name = "ActiveBrowserRunConflictError";
  }
}

export class BrowserRunStartingError extends Error {
  readonly code = "BROWSER_RUN_START_IN_PROGRESS" as const;

  constructor(readonly runId: string) {
    super(`Browser run ${runId} is still starting`);
    this.name = "BrowserRunStartingError";
  }
}

export class BrowserRuntimeLaunchFailedError extends Error {
  readonly code = "BROWSER_RUNTIME_LAUNCH_FAILED" as const;

  constructor(
    readonly runId: string,
    readonly failureCode: string,
    readonly phase: "before_spawn" | "spawn_uncertain",
  ) {
    super(`Browser runtime launch failed for run ${runId}: ${failureCode}`);
    this.name = "BrowserRuntimeLaunchFailedError";
  }
}

export class BrowserRuntimeRecoveryRequiredError extends Error {
  readonly code = "BROWSER_RUNTIME_RECOVERY_REQUIRED" as const;

  constructor(
    readonly runId: string,
    readonly failureCode: string,
  ) {
    super(`Browser run ${runId} requires recovery: ${failureCode}`);
    this.name = "BrowserRuntimeRecoveryRequiredError";
  }
}

export class BrowserRuntimeStopFailedError extends Error {
  readonly code = "BROWSER_RUNTIME_STOP_FAILED" as const;

  constructor(
    readonly runId: string,
    readonly failureCode: string,
  ) {
    super(`Browser runtime stop failed for run ${runId}: ${failureCode}`);
    this.name = "BrowserRuntimeStopFailedError";
  }
}
