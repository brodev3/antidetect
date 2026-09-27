import { sql, type Kysely } from "kysely";
import type { AppDatabaseSchema } from "../app.database.js";
import type { Migration } from "./migration.runner.js";

export const createProfilesMigration: Migration = {
  version: 1,
  name: "create_profiles_with_fingerprint_settings",
  async up(database: Kysely<AppDatabaseSchema>): Promise<void> {
    await sql`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        identity_ref TEXT CHECK (
          identity_ref IS NULL OR length(trim(identity_ref)) > 0
        ),
        fingerprint_enabled INTEGER NOT NULL DEFAULT 1 CHECK (
          fingerprint_enabled IN (0, 1)
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (fingerprint_enabled = 0 OR identity_ref IS NOT NULL)
      )
    `.execute(database);
  },
};
