import { randomUUID } from "node:crypto";
import type { ProfileRepository } from "../profiles/profile.repository.js";
import { ProfileNotFoundError } from "../profiles/profile.errors.js";
import { ProfileOperationMutex } from "../lifecycle/profile.operation.mutex.js";
import {
  ActiveBrowserRunConflictError,
  BrowserRunNotFoundError,
} from "./browser.run.errors.js";
import {
  isBrowserRunTerminal,
  transitionBrowserRun,
  type BrowserRunStatus,
} from "./browser.run.state.js";
import type { BrowserRun, BrowserRunRepository } from "./browser.run.repository.js";

export interface BrowserRunServiceOptions {
  readonly now?: () => string;
  readonly createRunId?: () => string;
}

export class BrowserRunService {
  private readonly now: () => string;
  private readonly createRunId: () => string;

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly runs: BrowserRunRepository,
    private readonly mutex: ProfileOperationMutex = new ProfileOperationMutex(),
    options: BrowserRunServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createRunId = options.createRunId ?? randomUUID;
  }

  async start(profileId: string): Promise<BrowserRun> {
    return this.mutex.runExclusive(profileId, async () => {
      const profile = await this.profiles.findById(profileId);
      if (profile === null) {
        throw new ProfileNotFoundError(profileId);
      }

      const activeRun = await this.runs.findActiveByProfileId(profileId);
      if (activeRun !== null) {
        throw new ActiveBrowserRunConflictError(profileId, activeRun.id);
      }

      const timestamp = this.now();
      const run: BrowserRun = {
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

      return this.runs.create(run);
    });
  }

  async transition(runId: string, to: BrowserRunStatus): Promise<BrowserRun> {
    const initialRun = await this.runs.findById(runId);
    if (initialRun === null) {
      throw new BrowserRunNotFoundError(runId);
    }

    return this.mutex.runExclusive(initialRun.profileId, async () => {
      const currentRun = await this.runs.findById(runId);
      if (currentRun === null) {
        throw new BrowserRunNotFoundError(runId);
      }

      const nextStatus = transitionBrowserRun(currentRun.status, to);
      if (nextStatus === currentRun.status) {
        return currentRun;
      }

      const timestamp = this.now();
      return this.runs.save({
        ...currentRun,
        status: nextStatus,
        updatedAt: timestamp,
        endedAt: isBrowserRunTerminal(nextStatus)
          ? (currentRun.endedAt ?? timestamp)
          : null,
      });
    });
  }
}
