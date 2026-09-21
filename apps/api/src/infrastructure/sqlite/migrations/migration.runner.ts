import { sql, type Kysely } from "kysely";
import type { AppDatabase, AppDatabaseSchema } from "../app.database.js";
import { addProfileCodesMigration } from "./003-add-profile-codes.js";
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
  addProfileCodesMigration,
];

export class IncompatibleDatabaseSchemaError extends Error {
  readonly code = "INCOMPATIBLE_DATABASE_SCHEMA" as const;

  constructor(message: string) {
    super(message);
    this.name = "IncompatibleDatabaseSchemaError";
  }
}

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
  const supportedVersions = new Map(
    migrations.map((migration) => [migration.version, migration.name]),
  );

  // Validate the entire history before applying any pending migration.
  for (const row of appliedRows) {
    const expectedName = supportedVersions.get(row.version);
    if (expectedName === undefined) {
      throw new IncompatibleDatabaseSchemaError(
        `Database migration version ${row.version} is not supported by this application`,
      );
    }
    if (row.name !== expectedName) {
      throw new IncompatibleDatabaseSchemaError(
        `Database migration version ${row.version} does not match the expected migration`,
      );
    }
  }

  let hasPendingMigration = false;
  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      hasPendingMigration = true;
    } else if (hasPendingMigration) {
      throw new IncompatibleDatabaseSchemaError(
        `Database migration history is incomplete before version ${migration.version}`,
      );
    }
  }

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
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
