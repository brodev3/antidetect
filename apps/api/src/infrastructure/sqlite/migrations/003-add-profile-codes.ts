import { sql, type Kysely } from "kysely";
import type { AppDatabaseSchema } from "../app.database.js";
import type { Migration } from "./migration.runner.js";

export const addProfileCodesMigration: Migration = {
  version: 3,
  name: "add_profile_codes",
  async up(database: Kysely<AppDatabaseSchema>): Promise<void> {
    await sql`
      ALTER TABLE profiles ADD COLUMN profile_code TEXT
    `.execute(database);

    await sql`
      CREATE TABLE profile_code_sequence (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        next_value INTEGER NOT NULL CHECK (next_value >= 1)
      )
    `.execute(database);

    const profiles = await database
      .selectFrom("profiles")
      .select(["id", "created_at"])
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();

    for (const [index, profile] of profiles.entries()) {
      await sql`
        UPDATE profiles
        SET profile_code = ${formatProfileCode(index + 1)}
        WHERE id = ${profile.id}
      `.execute(database);
    }

    await database
      .insertInto("profile_code_sequence")
      .values({ id: 1, next_value: profiles.length + 1 })
      .execute();

    await sql`
      CREATE UNIQUE INDEX profiles_profile_code_unique
      ON profiles (profile_code)
    `.execute(database);
  },
};

function formatProfileCode(sequenceValue: number): string {
  return `profile-${String(sequenceValue).padStart(3, "0")}`;
}
