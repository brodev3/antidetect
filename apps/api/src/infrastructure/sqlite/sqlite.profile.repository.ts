import { InvalidFingerprintIdentityError } from "../../application/fingerprints/fingerprint.identity.errors.js";
import type { FingerprintIdentity } from "../../application/fingerprints/fingerprint.identity.repository.js";
import { DEFAULT_FINGERPRINT_PLATFORM } from "../../application/fingerprints/fingerprint.generator.js";
import type {
  Profile,
  ProfileDraft,
  ProfileFingerprintSettings,
  ProfileFingerprintCreationRepository,
  ProfileListOptions,
  ProfileRepository,
} from "../../application/profiles/profile.repository.js";
import { sql } from "kysely";
import type { AppDatabase, ProfilesTable } from "./app.database.js";
import { SqliteFingerprintIdentityRepository } from "./sqlite.fingerprint.identity.repository.js";

function toProfile(row: ProfilesTable): Profile {
  return {
    id: row.id,
    profileCode: row.profile_code,
    displayName: row.display_name,
    fingerprintPlatform: row.fingerprint_platform,
    fingerprintEnabled: row.fingerprint_enabled === 1,
    identityRef: row.identity_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cloneIdentity(identity: FingerprintIdentity): FingerprintIdentity {
  try {
    return structuredClone(identity);
  } catch {
    throw new InvalidFingerprintIdentityError();
  }
}

export class SqliteProfileRepository
  implements ProfileRepository, ProfileFingerprintCreationRepository
{
  constructor(private readonly database: AppDatabase) {}

  async create(profile: ProfileDraft): Promise<Profile> {
    return this.database
      .transaction()
      .execute((transaction) => insertProfile(transaction, profile));
  }

  async createWithFingerprint(
    profile: Omit<ProfileDraft, "fingerprintEnabled" | "identityRef">,
    identity: FingerprintIdentity,
  ): Promise<Profile> {
    const profileSnapshot = {
      id: profile.id,
      displayName: profile.displayName,
      fingerprintPlatform: profile.fingerprintPlatform ?? DEFAULT_FINGERPRINT_PLATFORM,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
    const identitySnapshot = cloneIdentity(identity);

    return this.database.transaction().execute(async (transaction) => {
      const savedIdentity = await new SqliteFingerprintIdentityRepository(
        transaction,
      ).create(identitySnapshot);

      return insertProfile(transaction, {
        ...profileSnapshot,
        fingerprintEnabled: true,
        identityRef: savedIdentity.id,
      });
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
        ...(settings.fingerprintPlatform === undefined
          ? {}
          : { fingerprint_platform: settings.fingerprintPlatform }),
        updated_at: settings.updatedAt,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? null : toProfile(row);
  }

  async enableFingerprintWithIdentity(
    id: string,
    identity: FingerprintIdentity,
    updatedAt: string,
  ): Promise<Profile | null> {
    const identitySnapshot = cloneIdentity(identity);

    return this.database.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom("profiles")
        .select("id")
        .where("id", "=", id)
        .executeTakeFirst();
      if (existing === undefined) return null;

      await new SqliteFingerprintIdentityRepository(transaction).create(
        identitySnapshot,
      );
      const row = await transaction
        .updateTable("profiles")
        .set({
          fingerprint_enabled: 1,
          identity_ref: identitySnapshot.id,
          updated_at: updatedAt,
        })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      if (row === undefined) {
        throw new Error("Profile disappeared while enabling its fingerprint");
      }

      return toProfile(row);
    });
  }

  async replaceFingerprintIdentity(
    id: string,
    identity: FingerprintIdentity,
    updatedAt: string,
    fingerprintPlatform?: Profile["fingerprintPlatform"],
  ): Promise<Profile | null> {
    const identitySnapshot = cloneIdentity(identity);

    return this.database.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom("profiles")
        .select("id")
        .where("id", "=", id)
        .executeTakeFirst();
      if (existing === undefined) return null;

      await new SqliteFingerprintIdentityRepository(transaction).create(
        identitySnapshot,
      );
      const row = await transaction
        .updateTable("profiles")
        .set({
          identity_ref: identitySnapshot.id,
          ...(fingerprintPlatform === undefined
            ? {}
            : { fingerprint_platform: fingerprintPlatform }),
          updated_at: updatedAt,
        })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      if (row === undefined) {
        throw new Error("Profile disappeared while replacing its fingerprint identity");
      }

      return toProfile(row);
    });
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

async function insertProfile(
  database: AppDatabase,
  profile: ProfileDraft,
): Promise<Profile> {
  await database
    .updateTable("profile_code_sequence")
    .set({ next_value: sql<number>`next_value + 1` })
    .where("id", "=", 1)
    .execute();

  const sequence = await database
    .selectFrom("profile_code_sequence")
    .select("next_value")
    .where("id", "=", 1)
    .executeTakeFirst();

  if (sequence === undefined) {
    throw new Error("Profile code sequence is not initialized");
  }

  const createdProfile: Profile = {
    ...profile,
    fingerprintPlatform: profile.fingerprintPlatform ?? DEFAULT_FINGERPRINT_PLATFORM,
    profileCode: formatProfileCode(sequence.next_value - 1),
  };

  await database
    .insertInto("profiles")
    .values({
      id: createdProfile.id,
      profile_code: createdProfile.profileCode,
      display_name: createdProfile.displayName,
      fingerprint_platform: createdProfile.fingerprintPlatform,
      fingerprint_enabled: createdProfile.fingerprintEnabled ? 1 : 0,
      identity_ref: createdProfile.identityRef,
      created_at: createdProfile.createdAt,
      updated_at: createdProfile.updatedAt,
    })
    .execute();

  return createdProfile;
}

function formatProfileCode(sequenceValue: number): string {
  return `profile-${String(sequenceValue).padStart(3, "0")}`;
}
