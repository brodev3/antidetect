import type { BrowserRunStatus } from "./browser.run.state.js";

export interface BrowserRun {
  readonly id: string;
  readonly profileId: string;
  readonly status: BrowserRunStatus;
  readonly processPid: number | null;
  readonly processIdentity: string | null;
  readonly failureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
}

export interface BrowserRunRepository {
  create(run: BrowserRun): Promise<BrowserRun>;
  findById(id: string): Promise<BrowserRun | null>;
  findActiveByProfileId(profileId: string): Promise<BrowserRun | null>;
  findLatestByProfileId(profileId: string): Promise<BrowserRun | null>;
  listOccupying(): Promise<readonly BrowserRun[]>;
  save(run: BrowserRun): Promise<BrowserRun>;
}
