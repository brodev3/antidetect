import { sql, type Kysely } from "kysely";
import type { AppDatabaseSchema } from "../app.database.js";
import type { Migration } from "./migration.runner.js";

export const createFingerprintIdentitiesMigration: Migration = {
  version: 4,
  name: "create_fingerprint_identities",
  async up(database: Kysely<AppDatabaseSchema>): Promise<void> {
    await sql`
      ALTER TABLE profiles
      ADD COLUMN fingerprint_platform TEXT NOT NULL DEFAULT 'Windows'
      CHECK (fingerprint_platform IN ('Windows', 'macOS', 'Linux'))
    `.execute(database);

    // Keep historical limits fixed; new formats require a new migration.
    await sql`
      CREATE TABLE fingerprint_identities (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
        format_version INTEGER NOT NULL CHECK (format_version = 1),
        config_json TEXT NOT NULL CHECK (
          typeof(config_json) = 'text'
          AND length(CAST(config_json AS BLOB)) BETWEEN 2 AND 1048576
          AND CASE WHEN json_valid(config_json) THEN
            json_type(config_json) = 'object' AND json(config_json) <> '{}'
          ELSE 0 END
        ),
        created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0)
      )
    `.execute(database);

    await sql`
      CREATE TRIGGER fingerprint_identities_no_update
      BEFORE UPDATE ON fingerprint_identities
      BEGIN
        SELECT RAISE(ABORT, 'Fingerprint identity cannot be modified');
      END
    `.execute(database);

    await sql`
      CREATE TRIGGER fingerprint_identities_no_replace
      BEFORE INSERT ON fingerprint_identities
      WHEN EXISTS (SELECT 1 FROM fingerprint_identities WHERE id = NEW.id)
      BEGIN
        SELECT RAISE(ABORT, 'Fingerprint identity already exists');
      END
    `.execute(database);
  },
};
