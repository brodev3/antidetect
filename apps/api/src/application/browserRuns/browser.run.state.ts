import { InvalidBrowserRunTransitionError } from "./browser.run.errors.js";

export const browserRunStatuses = [
  "starting",
  "running",
  "stopping",
  "recovery_required",
  "stopped",
  "failed",
] as const;

export type BrowserRunStatus = (typeof browserRunStatuses)[number];

export const browserRunOccupyingStatuses = [
  "starting",
  "running",
  "stopping",
  "recovery_required",
] as const satisfies readonly BrowserRunStatus[];

const occupyingStatuses = new Set<BrowserRunStatus>(browserRunOccupyingStatuses);

const terminalStatuses = new Set<BrowserRunStatus>(["stopped", "failed"]);

const allowedTransitions: Readonly<
  Record<BrowserRunStatus, readonly BrowserRunStatus[]>
> = {
  starting: ["running", "failed", "recovery_required"],
  running: ["stopping", "stopped", "failed", "recovery_required"],
  stopping: ["stopped", "failed", "recovery_required"],
  recovery_required: ["stopped", "failed"],
  stopped: [],
  failed: [],
};

export function canTransitionBrowserRun(
  from: BrowserRunStatus,
  to: BrowserRunStatus,
): boolean {
  return from === to || allowedTransitions[from].includes(to);
}

export function transitionBrowserRun(
  from: BrowserRunStatus,
  to: BrowserRunStatus,
): BrowserRunStatus {
  if (!canTransitionBrowserRun(from, to)) {
    throw new InvalidBrowserRunTransitionError(from, to);
  }

  return to;
}

export function isBrowserRunOccupying(status: BrowserRunStatus): boolean {
  return occupyingStatuses.has(status);
}

export function isBrowserRunTerminal(status: BrowserRunStatus): boolean {
  return terminalStatuses.has(status);
}
