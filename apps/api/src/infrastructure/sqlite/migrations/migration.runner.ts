import { sql, type Kysely } from "kysely";
import type { AppDatabase, AppDatabaseSchema } from "../app.database.js";
import { createBrowserRunsMigration } from "./002-create-browser-runs.js";
import { createProfilesMigration } from "./001-create-profiles.js";

export interface Migration {
  readonly version: number;
  readonly name: string;
  up(database: Kysely<AppDatabaseSchema>): Promise<void>;
}

const migrations: readonly Migration[] = [
  createProfilesMigration,
  createBrowserRunsMigration,
];

export async function runMigrations(database: AppDatabase): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `.execute(database);

  const appliedRows = await database
    .selectFrom("schema_migrations")
    .select(["version", "name"])
    .execute();
  const appliedVersions = new Map(appliedRows.map((row) => [row.version, row.name]));

  for (const migration of migrations) {
    const appliedName = appliedVersions.get(migration.version);
    if (appliedName !== undefined) {
      if (appliedName !== migration.name) {
        throw new Error(
          `Migration version ${migration.version} is registered as ${appliedName}, expected ${migration.name}`,
        );
      }

      continue;
    }

    await database.transaction().execute(async (transaction) => {
      await migration.up(transaction);
      await transaction
        .insertInto("schema_migrations")
        .values({
          version: migration.version,
          name: migration.name,
          applied_at: new Date().toISOString(),
        })
        .execute();
    });
  }
}
