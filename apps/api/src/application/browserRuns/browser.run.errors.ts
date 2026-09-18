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
