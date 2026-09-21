import type {
  Profile,
  ProfileListOptions,
  ProfileRepository,
} from "../../application/profiles/profile.repository.js";
import type { AppDatabase, ProfilesTable } from "./app.database.js";

function toProfile(row: ProfilesTable): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    identityRef: row.identity_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteProfileRepository implements ProfileRepository {
  constructor(private readonly database: AppDatabase) {}

  async create(profile: Profile): Promise<Profile> {
    await this.database
      .insertInto("profiles")
      .values({
        id: profile.id,
        display_name: profile.displayName,
        identity_ref: profile.identityRef,
        created_at: profile.createdAt,
        updated_at: profile.updatedAt,
      })
      .execute();

    return profile;
  }

  async findById(id: string): Promise<Profile | null> {
    const row = await this.database
      .selectFrom("profiles")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    return row === undefined ? null : toProfile(row);
  }

  async list({ limit, offset }: ProfileListOptions): Promise<readonly Profile[]> {
    const rows = await this.database
      .selectFrom("profiles")
      .selectAll()
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map(toProfile);
  }
}
