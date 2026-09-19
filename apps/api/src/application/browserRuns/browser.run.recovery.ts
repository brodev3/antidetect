import type { BrowserRun, BrowserRunRepository } from "./browser.run.repository.js";

export interface RecoveryBarrierReady {
  readonly status: "ready";
  readonly blockingRuns: readonly [];
}

export interface RecoveryBarrierBlocked {
  readonly status: "blocked";
  readonly blockingRuns: readonly BrowserRun[];
}

export type RecoveryBarrierResult = RecoveryBarrierReady | RecoveryBarrierBlocked;

export type BlockingRunDiagnostic = Pick<BrowserRun, "id" | "profileId" | "status">;

export class RecoveryBarrierBlockedError extends Error {
  readonly code = "RECOVERY_BARRIER_BLOCKED" as const;
  readonly blockingRuns: readonly BlockingRunDiagnostic[];

  constructor(blockingRuns: readonly BrowserRun[]) {
    const diagnostics = blockingRuns.map(({ id, profileId, status }) => ({
      id,
      profileId,
      status,
    }));
    const details = diagnostics
      .map((run) => `${run.id} (${run.profileId}, ${run.status})`)
      .join(", ");
    super(`Recovery barrier blocked API startup: ${details}`);
    this.name = "RecoveryBarrierBlockedError";
    this.blockingRuns = diagnostics;
  }
}

/**
 * Read-only startup gate. It never infers process state or mutates a run.
 * Any persisted occupying run keeps readiness blocked until a later,
 * process-aware recovery flow proves that the run can be released.
 */
export class BrowserRunRecoveryBarrier {
  constructor(private readonly runs: BrowserRunRepository) {}

  async inspect(): Promise<RecoveryBarrierResult> {
    const blockingRuns = await this.runs.listOccupying();

    if (blockingRuns.length === 0) {
      return { status: "ready", blockingRuns: [] };
    }

    return { status: "blocked", blockingRuns };
  }

  assertReady(result: RecoveryBarrierResult): void {
    if (result.status === "blocked") {
      throw new RecoveryBarrierBlockedError(result.blockingRuns);
    }
  }
}
