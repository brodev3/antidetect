import type {
  Profile,
  ProfileDraft,
  ProfileFingerprintSettings,
  ProfileListOptions,
  ProfileRepository,
} from "../../application/profiles/profile.repository.js";
import { sql } from "kysely";
import type { AppDatabase, ProfilesTable } from "./app.database.js";

function toProfile(row: ProfilesTable): Profile {
  return {
    id: row.id,
    profileCode: row.profile_code,
    displayName: row.display_name,
    fingerprintEnabled: row.fingerprint_enabled === 1,
    identityRef: row.identity_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteProfileRepository implements ProfileRepository {
  constructor(private readonly database: AppDatabase) {}

  async create(profile: ProfileDraft): Promise<Profile> {
    return this.database.transaction().execute(async (transaction) => {
      await transaction
        .updateTable("profile_code_sequence")
        .set({ next_value: sql<number>`next_value + 1` })
        .where("id", "=", 1)
        .execute();

      const sequence = await transaction
        .selectFrom("profile_code_sequence")
        .select("next_value")
        .where("id", "=", 1)
        .executeTakeFirst();

      if (sequence === undefined) {
        throw new Error("Profile code sequence is not initialized");
      }

      const createdProfile: Profile = {
        ...profile,
        profileCode: formatProfileCode(sequence.next_value - 1),
      };

      await transaction
        .insertInto("profiles")
        .values({
          id: createdProfile.id,
          profile_code: createdProfile.profileCode,
          display_name: createdProfile.displayName,
          fingerprint_enabled: createdProfile.fingerprintEnabled ? 1 : 0,
          identity_ref: createdProfile.identityRef,
          created_at: createdProfile.createdAt,
          updated_at: createdProfile.updatedAt,
        })
        .execute();

      return createdProfile;
    });
  }

  async findById(id: string): Promise<Profile | null> {
    const row = await this.database
      .selectFrom("profiles")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    return row === undefined ? null : toProfile(row);
  }

  async updateFingerprintSettings(
    id: string,
    settings: ProfileFingerprintSettings,
  ): Promise<Profile | null> {
    const row = await this.database
      .updateTable("profiles")
      .set({
        fingerprint_enabled: settings.fingerprintEnabled ? 1 : 0,
        identity_ref: settings.identityRef,
        updated_at: settings.updatedAt,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? null : toProfile(row);
  }

  async list({
    limit,
    offset,
    search,
    sortBy,
    sortOrder,
  }: ProfileListOptions): Promise<readonly Profile[]> {
    let query = this.database.selectFrom("profiles").selectAll();
    const normalizedSearch = search?.trim();

    if (normalizedSearch !== undefined && normalizedSearch.length > 0) {
      query = query.where(
        sql<boolean>`instr(unicode_lower(display_name), unicode_lower(${normalizedSearch})) > 0`,
      );
    }

    const orderedQuery =
      sortBy === "displayName"
        ? query.orderBy("display_name", sortOrder)
        : query.orderBy("created_at", sortOrder);
    const rows = await orderedQuery
      .orderBy("id", "asc")
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map(toProfile);
  }
}

function formatProfileCode(sequenceValue: number): string {
  return `profile-${String(sequenceValue).padStart(3, "0")}`;
}
