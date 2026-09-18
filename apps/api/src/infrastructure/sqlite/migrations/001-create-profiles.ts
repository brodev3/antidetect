import { sql, type Kysely } from "kysely";
import type { AppDatabaseSchema } from "../app.database.js";
import type { Migration } from "./migration.runner.js";

export const createProfilesMigration: Migration = {
  version: 1,
  name: "create_profiles",
  async up(database: Kysely<AppDatabaseSchema>): Promise<void> {
    await sql`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        identity_ref TEXT NOT NULL CHECK (length(trim(identity_ref)) > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `.execute(database);
  },
};
