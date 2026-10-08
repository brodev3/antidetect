import { Buffer } from "node:buffer";
import { sql } from "kysely";
import { z } from "zod";
import {
  CorruptFingerprintIdentityError,
  InvalidFingerprintIdentityError,
} from "../../application/fingerprints/fingerprint.identity.errors.js";
import {
  FINGERPRINT_FORMAT_VERSION,
  MAX_FINGERPRINT_CONFIG_BYTES,
  type FingerprintIdentity,
  type FingerprintIdentityRepository,
} from "../../application/fingerprints/fingerprint.identity.repository.js";
import type { AppDatabase } from "./app.database.js";

const identitySchema = z.object({
  id: z.uuid(),
  formatVersion: z.literal(FINGERPRINT_FORMAT_VERSION),
  config: z
    .record(z.string(), z.json())
    .refine((config) => Object.keys(config).length > 0),
  createdAt: z.iso.datetime({ offset: true }),
});

function serializeIdentity(identity: FingerprintIdentity): {
  readonly identity: FingerprintIdentity;
  readonly configJson: string;
} {
  try {
    const parsed = identitySchema.safeParse(identity);
    if (!parsed.success) throw new InvalidFingerprintIdentityError();

    const configJson = JSON.stringify(parsed.data.config);
    if (Buffer.byteLength(configJson, "utf8") > MAX_FINGERPRINT_CONFIG_BYTES) {
      throw new InvalidFingerprintIdentityError();
    }
    return { identity: parsed.data, configJson };
  } catch {
    // Validation, cycles, getters and serialization errors must not leak config.
    throw new InvalidFingerprintIdentityError();
  }
}

export class SqliteFingerprintIdentityRepository implements FingerprintIdentityRepository {
  // A Kysely transaction can be supplied to share a future profile assignment.
  constructor(private readonly database: AppDatabase) {}

  async create(identity: FingerprintIdentity): Promise<FingerprintIdentity> {
    const serialized = serializeIdentity(identity);
    await this.database
      .insertInto("fingerprint_identities")
      .values({
        id: serialized.identity.id,
        format_version: serialized.identity.formatVersion,
        config_json: serialized.configJson,
        created_at: serialized.identity.createdAt,
      })
      .execute();

    return serialized.identity;
  }

  async findById(id: string): Promise<FingerprintIdentity | null> {
    const row = await this.database
      .selectFrom("fingerprint_identities")
      .select([
        "id",
        "format_version",
        "created_at",
        sql<string | null>`
          CASE WHEN typeof(config_json) = 'text'
            AND length(CAST(config_json AS BLOB)) <= ${MAX_FINGERPRINT_CONFIG_BYTES}
          THEN config_json ELSE NULL END
        `.as("config_json"),
      ])
      .where("id", "=", id)
      .executeTakeFirst();

    if (row === undefined) return null;

    try {
      if (row.config_json === null) throw new CorruptFingerprintIdentityError();
      const config: unknown = JSON.parse(row.config_json);
      const parsed = identitySchema.safeParse({
        id: row.id,
        formatVersion: row.format_version,
        config,
        createdAt: row.created_at,
      });
      if (!parsed.success) throw new CorruptFingerprintIdentityError();
      return parsed.data;
    } catch {
      throw new CorruptFingerprintIdentityError();
    }
  }
}
