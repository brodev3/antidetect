import type {
  Profile,
  ProfileListOptions,
  ProfileRepository,
} from "../../application/profiles/profile.repository.js";
import { sql } from "kysely";
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
        sql<boolean>`instr(lower(display_name), lower(${normalizedSearch})) > 0`,
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
