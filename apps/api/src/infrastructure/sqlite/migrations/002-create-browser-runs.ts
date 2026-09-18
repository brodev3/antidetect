import { sql, type Kysely } from "kysely";
import type { AppDatabaseSchema } from "../app.database.js";
import type { Migration } from "./migration.runner.js";

export const createBrowserRunsMigration: Migration = {
  version: 2,
  name: "create_browser_runs",
  async up(database: Kysely<AppDatabaseSchema>): Promise<void> {
    await sql`
      CREATE TABLE browser_runs (
        id TEXT PRIMARY KEY NOT NULL,
        profile_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN (
            'starting',
            'running',
            'stopping',
            'recovery_required',
            'stopped',
            'failed'
          )
        ),
        process_pid INTEGER,
        process_identity TEXT,
        failure_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT,
        FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE RESTRICT
      )
    `.execute(database);

    await sql`
      CREATE UNIQUE INDEX browser_runs_one_active_per_profile
      ON browser_runs (profile_id)
      WHERE status IN ('starting', 'running', 'stopping', 'recovery_required')
    `.execute(database);
  },
};
