import type {
  BrowserRun,
  BrowserRunRepository,
} from "../../application/browserRuns/browser.run.repository.js";
import type { AppDatabase, BrowserRunsTable } from "./app.database.js";

const occupyingStatuses = [
  "starting",
  "running",
  "stopping",
  "recovery_required",
] as const;

function toBrowserRun(row: BrowserRunsTable): BrowserRun {
  return {
    id: row.id,
    profileId: row.profile_id,
    status: row.status as BrowserRun["status"],
    processPid: row.process_pid,
    processIdentity: row.process_identity,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
  };
}

function toRow(run: BrowserRun): BrowserRunsTable {
  return {
    id: run.id,
    profile_id: run.profileId,
    status: run.status,
    process_pid: run.processPid,
    process_identity: run.processIdentity,
    failure_code: run.failureCode,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    ended_at: run.endedAt,
  };
}

export class SqliteBrowserRunRepository implements BrowserRunRepository {
  constructor(private readonly database: AppDatabase) {}

  async create(run: BrowserRun): Promise<BrowserRun> {
    await this.database.insertInto("browser_runs").values(toRow(run)).execute();
    return run;
  }

  async findById(id: string): Promise<BrowserRun | null> {
    const row = await this.database
      .selectFrom("browser_runs")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    return row === undefined ? null : toBrowserRun(row);
  }

  async findActiveByProfileId(profileId: string): Promise<BrowserRun | null> {
    const row = await this.database
      .selectFrom("browser_runs")
      .selectAll()
      .where("profile_id", "=", profileId)
      .where("status", "in", occupyingStatuses)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();

    return row === undefined ? null : toBrowserRun(row);
  }

  async save(run: BrowserRun): Promise<BrowserRun> {
    const result = await this.database
      .updateTable("browser_runs")
      .set({
        status: run.status,
        process_pid: run.processPid,
        process_identity: run.processIdentity,
        failure_code: run.failureCode,
        updated_at: run.updatedAt,
        ended_at: run.endedAt,
      })
      .where("id", "=", run.id)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error(`Browser run ${run.id} was not found`);
    }

    return run;
  }
}
