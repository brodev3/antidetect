import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { expect, test } from "vitest";
import {
  CorruptFingerprintIdentityError,
  InvalidFingerprintIdentityError,
} from "../src/application/fingerprints/fingerprint.identity.errors.ts";
import {
  FINGERPRINT_FORMAT_VERSION,
  MAX_FINGERPRINT_CONFIG_BYTES,
  type FingerprintIdentity,
} from "../src/application/fingerprints/fingerprint.identity.repository.ts";
import {
  createAppDatabase,
  type AppDatabase,
} from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";
import { SqliteFingerprintIdentityRepository } from "../src/infrastructure/sqlite/sqlite.fingerprint.identity.repository.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";

const identity: FingerprintIdentity = {
  id: "5625c842-282d-42aa-a8b2-f06e79d50e6f",
  formatVersion: FINGERPRINT_FORMAT_VERSION,
  config: {
    navigator: { platform: "Win32", languages: ["en-US", "ru-RU"] },
    screen: { width: 1920, height: 1080 },
    enabled: true,
    optional: null,
  },
  createdAt: "2026-10-05T10:00:00.000Z",
};

const secondIdentityId = "cf7c7db4-0b0b-470d-b0ca-2866505e95a1";

async function withDatabase(
  callback: (database: AppDatabase) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), "antidetect-fingerprint-repository-"));
  const owner = acquireRootOwnership(join(root, "antidetect.sqlite"));
  const database = createAppDatabase(owner);
  try {
    await runMigrations(database);
    await callback(database);
  } finally {
    await database.destroy();
    owner.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("persists JSON text and reads the same fingerprint after reopening SQLite", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "antidetect-fingerprint-persistence-"));
  try {
    for (const round of [0, 1]) {
      const owner = acquireRootOwnership(join(root, "antidetect.sqlite"));
      const database = createAppDatabase(owner);
      try {
        await runMigrations(database);
        const repository = new SqliteFingerprintIdentityRepository(database);
        if (round === 0) {
          await expect(repository.findById(identity.id)).resolves.toBeNull();
          await expect(repository.create(identity)).resolves.toEqual(identity);
          const row = await database
            .selectFrom("fingerprint_identities")
            .selectAll()
            .executeTakeFirstOrThrow();
          expect(row).toEqual({
            id: identity.id,
            format_version: identity.formatVersion,
            config_json: JSON.stringify(identity.config),
            created_at: identity.createdAt,
          });
        }
        await expect(repository.findById(identity.id)).resolves.toEqual(identity);
        await expect(repository.findById(secondIdentityId)).resolves.toBeNull();
      } finally {
        await database.destroy();
        owner.close();
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("snapshots input before awaiting and returns independent working copies", async () => {
  await withDatabase(async (database) => {
    const repository = new SqliteFingerprintIdentityRepository(database);
    const config = { navigator: { languages: ["en-US"] } };
    const expected = { ...identity, config: { navigator: { languages: ["en-US"] } } };
    const pending = repository.create({ ...identity, config });
    config.navigator.languages.push("ru-RU");
    const created = await pending;
    expect(created).toEqual(expected);
    (created.config.navigator as { languages: string[] }).languages.push("changed");
    const loaded = await repository.findById(identity.id);
    expect(loaded).toEqual(expected);
    if (loaded === null) throw new Error("Expected saved fingerprint identity");
    (loaded.config.navigator as { languages: string[] }).languages.push(
      "changed-again",
    );
    await expect(repository.findById(identity.id)).resolves.toEqual(expected);
  });
});

test("rejects duplicate ids and replaces an identity only by creating a new id", async () => {
  await withDatabase(async (database) => {
    const repository = new SqliteFingerprintIdentityRepository(database);
    await repository.create(identity);
    const changed = { ...identity, config: { screen: { width: 1280 } } };
    await expect(repository.create(changed)).rejects.toThrow(
      "Fingerprint identity already exists",
    );
    await expect(
      repository.create({ ...changed, id: secondIdentityId }),
    ).resolves.toEqual({ ...changed, id: secondIdentityId });
    await expect(repository.findById(identity.id)).resolves.toEqual(identity);
    await expect(
      database.selectFrom("fingerprint_identities").select("id").execute(),
    ).resolves.toHaveLength(2);
  });
});

test("SQLite forbids direct updates and INSERT OR REPLACE for an existing identity", async () => {
  await withDatabase(async (database) => {
    const repository = new SqliteFingerprintIdentityRepository(database);
    await repository.create(identity);
    await expect(
      database
        .updateTable("fingerprint_identities")
        .set({ config_json: '{"changed":true}' })
        .where("id", "=", identity.id)
        .execute(),
    ).rejects.toThrow("Fingerprint identity cannot be modified");
    await expect(
      sql`
      INSERT OR REPLACE INTO fingerprint_identities (id, format_version, config_json, created_at)
      VALUES (${identity.id}, 1, '{"changed":true}', ${identity.createdAt})
    `.execute(database),
    ).rejects.toThrow("Fingerprint identity already exists");
    await expect(repository.findById(identity.id)).resolves.toEqual(identity);
  });
});

test.each([
  { label: "invalid uuid", changes: { id: "test-identity:not-a-uuid" } },
  { label: "unsupported format", changes: { formatVersion: 2 } },
  { label: "invalid timestamp", changes: { createdAt: "yesterday" } },
  { label: "empty object", changes: { config: {} } },
  { label: "null", changes: { config: null } },
  { label: "array", changes: { config: [1, 2] } },
  { label: "undefined", changes: { config: { value: undefined } } },
  { label: "function", changes: { config: { value: () => "do-not-leak" } } },
  { label: "bigint", changes: { config: { value: 1n } } },
  { label: "NaN", changes: { config: { value: Number.NaN } } },
  { label: "infinity", changes: { config: { value: Number.POSITIVE_INFINITY } } },
  { label: "date", changes: { config: { value: new Date(identity.createdAt) } } },
])("rejects $label before writing and uses a safe error", async ({ changes }) => {
  await withDatabase(async (database) => {
    const repository = new SqliteFingerprintIdentityRepository(database);
    await expect(
      repository.create({ ...identity, ...changes } as FingerprintIdentity),
    ).rejects.toEqual(new InvalidFingerprintIdentityError());
    await expect(
      database.selectFrom("fingerprint_identities").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});

test("cycles and throwing getters produce fixed errors without exposing data", async () => {
  await withDatabase(async (database) => {
    const repository = new SqliteFingerprintIdentityRepository(database);
    const cycle: Record<string, unknown> = { marker: "do-not-leak" };
    cycle.self = cycle;
    const throwing = {
      get value(): string {
        throw new Error("do-not-leak");
      },
    };
    for (const config of [cycle, throwing]) {
      await expect(repository.create({ ...identity, config })).rejects.toEqual(
        new InvalidFingerprintIdentityError(),
      );
    }
    await expect(
      database.selectFrom("fingerprint_identities").selectAll().execute(),
    ).resolves.toEqual([]);
  });
});

test("accepts the exact byte limit and rejects larger or multibyte JSON", async () => {
  await withDatabase(async (database) => {
    const repository = new SqliteFingerprintIdentityRepository(database);
    const overhead = Buffer.byteLength(JSON.stringify({ payload: "" }), "utf8");
    const config = { payload: "a".repeat(MAX_FINGERPRINT_CONFIG_BYTES - overhead) };
    expect(Buffer.byteLength(JSON.stringify(config), "utf8")).toBe(
      MAX_FINGERPRINT_CONFIG_BYTES,
    );
    await expect(repository.create({ ...identity, config })).resolves.toMatchObject({
      id: identity.id,
    });
    await expect(repository.findById(identity.id)).resolves.toMatchObject({ config });
    await expect(
      repository.create({
        ...identity,
        id: secondIdentityId,
        config: { payload: config.payload + "a" },
      }),
    ).rejects.toEqual(new InvalidFingerprintIdentityError());
    const multibyte = { payload: "ж".repeat(MAX_FINGERPRINT_CONFIG_BYTES / 2) };
    expect(JSON.stringify(multibyte).length).toBeLessThan(MAX_FINGERPRINT_CONFIG_BYTES);
    await expect(
      repository.create({ ...identity, id: secondIdentityId, config: multibyte }),
    ).rejects.toEqual(new InvalidFingerprintIdentityError());
    await expect(
      database.selectFrom("fingerprint_identities").select("id").execute(),
    ).resolves.toEqual([{ id: identity.id }]);
  });
});

test.each(["not-json", "null", "[]", "true", "{}", " { } ", '{"value":NaN}'])(
  "SQLite rejects invalid or empty config %s",
  async (configJson) => {
    await withDatabase(async (database) => {
      await expect(
        database
          .insertInto("fingerprint_identities")
          .values({
            id: identity.id,
            format_version: identity.formatVersion,
            config_json: configJson,
            created_at: identity.createdAt,
          })
          .execute(),
      ).rejects.toThrow();
      await expect(
        database.selectFrom("fingerprint_identities").selectAll().execute(),
      ).resolves.toEqual([]);
    });
  },
);

test("SQLite independently enforces format and UTF-8 byte limits", async () => {
  await withDatabase(async (database) => {
    for (const changes of [
      { format_version: 2 },
      {
        config_json: JSON.stringify({
          payload: "ж".repeat(MAX_FINGERPRINT_CONFIG_BYTES / 2),
        }),
      },
    ]) {
      await expect(
        database
          .insertInto("fingerprint_identities")
          .values({
            id: identity.id,
            format_version: identity.formatVersion,
            config_json: JSON.stringify(identity.config),
            created_at: identity.createdAt,
            ...changes,
          })
          .execute(),
      ).rejects.toThrow();
    }
  });
});

test.each([
  { label: "malformed JSON", changes: { config_json: '{"marker":"do-not-leak"' } },
  { label: "empty JSON", changes: { config_json: "{}" } },
  { label: "array JSON", changes: { config_json: "[]" } },
  { label: "unsupported format", changes: { format_version: 2 } },
  { label: "invalid timestamp", changes: { created_at: "do-not-leak" } },
  { label: "invalid uuid", changes: { id: "x".repeat(36) } },
  {
    label: "oversized JSON",
    changes: {
      config_json: JSON.stringify({
        payload: "a".repeat(MAX_FINGERPRINT_CONFIG_BYTES),
      }),
    },
  },
])("rejects stored $label without repairing or replacing it", async ({ changes }) => {
  await withDatabase(async (database) => {
    const row = {
      id: identity.id,
      format_version: identity.formatVersion,
      config_json: JSON.stringify(identity.config),
      created_at: identity.createdAt,
      ...changes,
    };
    // Bypass CHECK only in this temporary database to simulate damaged storage.
    await sql`PRAGMA ignore_check_constraints = ON`.execute(database);
    try {
      await database.insertInto("fingerprint_identities").values(row).execute();
    } finally {
      await sql`PRAGMA ignore_check_constraints = OFF`.execute(database);
    }
    await expect(
      new SqliteFingerprintIdentityRepository(database).findById(row.id),
    ).rejects.toEqual(new CorruptFingerprintIdentityError());
    await expect(
      database.selectFrom("fingerprint_identities").selectAll().execute(),
    ).resolves.toEqual([row]);
  });
});

test.each([true, false])(
  "shares profile assignment transaction (commit: %s)",
  async (commit) => {
    await withDatabase(async (database) => {
      const profiles = new SqliteProfileRepository(database);
      const profile = await profiles.create({
        id: "profile-for-fingerprint",
        displayName: "Profile for fingerprint",
        fingerprintEnabled: true,
        identityRef: "test-identity:profile-for-fingerprint",
        createdAt: identity.createdAt,
        updatedAt: identity.createdAt,
      });
      const transaction = database
        .transaction()
        .execute(async (databaseTransaction) => {
          await new SqliteFingerprintIdentityRepository(databaseTransaction).create(
            identity,
          );
          await new SqliteProfileRepository(
            databaseTransaction,
          ).updateFingerprintSettings(profile.id, {
            fingerprintEnabled: true,
            identityRef: identity.id,
            updatedAt: identity.createdAt,
          });
          if (!commit) throw new Error("injected assignment failure");
        });
      if (commit) {
        await expect(transaction).resolves.toBeUndefined();
      } else {
        await expect(transaction).rejects.toThrow("injected assignment failure");
      }
      await expect(
        new SqliteFingerprintIdentityRepository(database).findById(identity.id),
      ).resolves.toEqual(commit ? identity : null);
      await expect(profiles.findById(profile.id)).resolves.toEqual({
        ...profile,
        identityRef: commit ? identity.id : profile.identityRef,
      });
    });
  },
);
