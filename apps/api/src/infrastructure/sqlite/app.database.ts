import { Kysely, SqliteDialect, sql } from "kysely";
import type { RootOwnership } from "./root.ownership.js";

export type AppDatabaseSchema = Record<string, never>;

export type AppDatabase = Kysely<AppDatabaseSchema>;

export function createAppDatabase(rootOwnership: RootOwnership): AppDatabase {
  return new Kysely<AppDatabaseSchema>({
    dialect: new SqliteDialect({ database: rootOwnership.sqlite }),
  });
}

export async function verifyAppDatabase(database: AppDatabase): Promise<void> {
  await sql`select 1`.execute(database);
}
