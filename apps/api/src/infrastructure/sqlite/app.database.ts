import { Kysely, SqliteDialect, sql } from "kysely";
import type { RootOwnership } from "./root.ownership.js";
import type { FingerprintPlatform } from "../../application/fingerprints/fingerprint.generator.js";

export interface SchemaMigrationsTable {
  version: number;
  name: string;
  applied_at: string;
}

export interface ProfilesTable {
  id: string;
  profile_code: string;
  display_name: string;
  fingerprint_platform: FingerprintPlatform;
  fingerprint_enabled: number;
  identity_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileCodeSequenceTable {
  id: number;
  next_value: number;
}

export interface FingerprintIdentitiesTable {
  id: string;
  format_version: number;
  config_json: string;
  created_at: string;
}

export interface BrowserRunsTable {
  id: string;
  profile_id: string;
  status: string;
  process_pid: number | null;
  process_identity: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface AppDatabaseSchema {
  schema_migrations: SchemaMigrationsTable;
  profiles: ProfilesTable;
  profile_code_sequence: ProfileCodeSequenceTable;
  fingerprint_identities: FingerprintIdentitiesTable;
  browser_runs: BrowserRunsTable;
}

export type AppDatabase = Kysely<AppDatabaseSchema>;

export function createAppDatabase(rootOwnership: RootOwnership): AppDatabase {
  return new Kysely<AppDatabaseSchema>({
    dialect: new SqliteDialect({ database: rootOwnership.sqlite }),
  });
}

export async function verifyAppDatabase(database: AppDatabase): Promise<void> {
  await sql`select 1`.execute(database);
}
