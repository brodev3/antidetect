import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { expect, test, vi } from "vitest";
import type { FingerprintGenerator } from "../src/application/fingerprints/fingerprint.generator.ts";
import { CorruptFingerprintIdentityError } from "../src/application/fingerprints/fingerprint.identity.errors.ts";
import {
  FINGERPRINT_FORMAT_VERSION,
  type FingerprintIdentity,
  type FingerprintIdentityRepository,
} from "../src/application/fingerprints/fingerprint.identity.repository.ts";
import { ProfileCreationService } from "../src/application/profiles/profile.creation.service.ts";
import type { RuntimeLaunchInput } from "../src/application/runtime/browser.runtime.ts";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { ShardXLaunchPreparer } from "../src/infrastructure/runtime/shardx.launch.preparation.ts";
import {
  createAppDatabase,
  type AppDatabase,
} from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";
import { SqliteFingerprintIdentityRepository } from "../src/infrastructure/sqlite/sqlite.fingerprint.identity.repository.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";

const profileId = "f4ace6a0-5049-46af-8b49-797b2216cc2e";
const identityId = "cf7c7db4-0b0b-470d-b0ca-2866505e95a1";
const runIds = [
  "51b7b0bc-ef2a-4a7b-8591-151e5ff2d7d0",
  "d30b059f-0cce-4a5b-b7a8-9aa0c0bcb42a",
] as const;
const timestamp = "2026-10-05T10:00:00.000Z";
const config = { navigator: { platform: "Windows", languages: ["en-US"] } };
const identity: FingerprintIdentity = {
  id: identityId,
  formatVersion: FINGERPRINT_FORMAT_VERSION,
  config,
  createdAt: timestamp,
};
const unavailable = {
  status: "failed_before_spawn",
  failureCode: "RUNTIME_FINGERPRINT_UNAVAILABLE",
};

function forbiddenSdkOperations() {
  const forbidden = () =>
    vi.fn().mockImplementation(() => {
      throw new Error("Operation is forbidden during stored preparation");
    });
  return {
    listProfiles: vi.fn<() => Promise<string[]>>().mockResolvedValue(["template"]),
    launch: forbidden(),
    session: forbidden(),
    install: forbidden(),
    randomProfile: forbidden(),
    createProfile: forbidden(),
    saveProfile: forbidden(),
  };
}

function expectPreparationOnly(sdk: ReturnType<typeof forbiddenSdkOperations>): void {
  for (const operation of [
    sdk.launch,
    sdk.session,
    sdk.install,
    sdk.randomProfile,
    sdk.createProfile,
    sdk.saveProfile,
  ]) {
    expect(operation).not.toHaveBeenCalled();
  }
}

function fixture() {
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tmpdir(), "antidetect-stored-preparation-mock") },
  });
  const input: RuntimeLaunchInput = {
    profileId,
    runId: runIds[0],
    profileDirectory: join(paths.profilesDir, profileId),
    identityRef: identityId,
  };
  const identities = {
    findById: vi
      .fn<FingerprintIdentityRepository["findById"]>()
      .mockResolvedValue(identity),
    create: vi
      .fn<FingerprintIdentityRepository["create"]>()
      .mockRejectedValue(new Error("Identity writes are forbidden")),
  };
  const sdk = forbiddenSdkOperations();
  return {
    paths,
    input,
    identities,
    sdk,
    preparer: new ShardXLaunchPreparer(paths, sdk),
  };
}

async function withDatabase(
  callback: (database: AppDatabase) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "antidetect-stored-preparation-"));
  const owner = acquireRootOwnership(join(root, "antidetect.sqlite"));
  const database = createAppDatabase(owner);
  try {
    await runMigrations(database);
    await callback(database);
  } finally {
    await database.destroy();
    owner.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("loads exactly the persisted reference and prepares a separate SDK working copy", async () => {
  const { input, identities, sdk, preparer } = fixture();
  const result = await preparer.prepareStored(input, identities);
  expect(identities.findById).toHaveBeenCalledExactlyOnceWith(identityId);
  expect(result.status).toBe("prepared");
  if (result.status !== "prepared") throw new Error("Expected prepared input");
  expect(result.profile.id).toBe(profileId);
  expect(result.profile.config).toEqual(config);
  expect(result.options).toEqual({
    userDataDir: input.profileDirectory,
    randomize: false,
    headless: false,
    cdp: true,
  });
  result.profile.config.navigator = { platform: "SDK mutation" };
  expect(identity.config).toEqual(config);
  expect(identities.create).not.toHaveBeenCalled();
  expect(sdk.listProfiles).toHaveBeenCalledExactlyOnceWith();
  expectPreparationOnly(sdk);
  expect(result).not.toHaveProperty("process");
});

test.each([
  ["invalid run UUID", { runId: "not-a-run" }, "RUNTIME_LAUNCH_INPUT_INVALID"],
  [
    "invalid profile UUID",
    { profileId: "../other-profile" },
    "RUNTIME_LAUNCH_INPUT_INVALID",
  ],
  [
    "relative directory",
    { profileDirectory: "relative" },
    "RUNTIME_LAUNCH_INPUT_INVALID",
  ],
  [
    "another profile directory",
    { profileDirectory: join(tmpdir(), "another-profile") },
    "RUNTIME_LAUNCH_INPUT_INVALID",
  ],
  [
    "NUL directory",
    { profileDirectory: `${tmpdir()}\0` },
    "RUNTIME_LAUNCH_INPUT_INVALID",
  ],
  [
    "disabled fingerprint",
    { identityRef: null },
    "RUNTIME_FINGERPRINT_MODE_UNSUPPORTED",
  ],
  ["empty reference", { identityRef: "" }, "RUNTIME_FINGERPRINT_UNAVAILABLE"],
  [
    "test reference",
    { identityRef: `test-identity:${profileId}` },
    "RUNTIME_FINGERPRINT_UNAVAILABLE",
  ],
  [
    "non-UUID reference",
    { identityRef: "fingerprint:manual-fixture" },
    "RUNTIME_FINGERPRINT_UNAVAILABLE",
  ],
] as const)(
  "rejects %s before reading storage or calling the SDK",
  async (_, changes, failureCode) => {
    const { input, identities, sdk, preparer } = fixture();
    await expect(
      preparer.prepareStored({ ...input, ...changes }, identities),
    ).resolves.toEqual({ status: "failed_before_spawn", failureCode });
    expect(identities.findById).not.toHaveBeenCalled();
    expect(identities.create).not.toHaveBeenCalled();
    expect(sdk.listProfiles).not.toHaveBeenCalled();
    expectPreparationOnly(sdk);
  },
);

test.each([
  ["missing identity", null],
  ["another identity", { ...identity, id: runIds[1] }],
  ["unsupported format", { ...identity, formatVersion: 2 }],
  ["empty configuration", { ...identity, config: {} }],
  ["non-JSON configuration", { ...identity, config: { value: 1n } }],
] as const)("rejects %s without replacement or SDK readiness", async (_, stored) => {
  const { input, identities, sdk, preparer } = fixture();
  identities.findById.mockResolvedValue(stored);
  await expect(preparer.prepareStored(input, identities)).resolves.toEqual(unavailable);
  expect(identities.findById).toHaveBeenCalledExactlyOnceWith(identityId);
  expect(identities.create).not.toHaveBeenCalled();
  expect(sdk.listProfiles).not.toHaveBeenCalled();
  expectPreparationOnly(sdk);
});

test.each([
  new CorruptFingerprintIdentityError(),
  new Error("private-storage-detail-sentinel"),
  "private-storage-detail-sentinel",
])(
  "returns a fixed failure for a storage rejection without leaking its details",
  async (error) => {
    const { input, identities, sdk, preparer } = fixture();
    identities.findById.mockRejectedValue(error);
    const result = await preparer.prepareStored(input, identities);
    expect(result).toEqual(unavailable);
    expect(JSON.stringify(result)).not.toContain("private-storage-detail-sentinel");
    expect(identities.create).not.toHaveBeenCalled();
    expect(sdk.listProfiles).not.toHaveBeenCalled();
    expectPreparationOnly(sdk);
  },
);

test("returns a fixed failure if reading stored metadata throws", async () => {
  const { input, identities, sdk, preparer } = fixture();
  const stored = { ...identity };
  Object.defineProperty(stored, "config", {
    get() {
      throw new Error("private-config-sentinel");
    },
  });
  identities.findById.mockResolvedValue(stored);
  await expect(preparer.prepareStored(input, identities)).resolves.toEqual(unavailable);
  expect(sdk.listProfiles).not.toHaveBeenCalled();
  expectPreparationOnly(sdk);
});

test("snapshots launch metadata before awaiting the identity lookup", async () => {
  const { input, identities, sdk, preparer } = fixture();
  let finishLookup: ((value: FingerprintIdentity) => void) | undefined;
  identities.findById.mockReturnValue(
    new Promise<FingerprintIdentity>((resolve) => {
      finishLookup = resolve;
    }),
  );
  const mutable = { ...input };
  const pending = preparer.prepareStored(mutable, identities);
  expect(sdk.listProfiles).not.toHaveBeenCalled();
  mutable.profileId = runIds[1];
  mutable.runId = runIds[1];
  mutable.profileDirectory = join(tmpdir(), "changed-directory");
  mutable.identityRef = runIds[1];
  if (finishLookup === undefined) throw new Error("Identity lookup did not start");
  finishLookup(identity);
  const result = await pending;
  expect(result.status).toBe("prepared");
  if (result.status !== "prepared") throw new Error("Expected prepared input");
  expect(result.profile.id).toBe(profileId);
  expect(result.profile.config).toEqual(config);
  expect(result.options.userDataDir).toBe(input.profileDirectory);
  expect(identities.findById).toHaveBeenCalledExactlyOnceWith(identityId);
  expectPreparationOnly(sdk);
});

test("preserves missing-installation failure after loading an available identity", async () => {
  const { input, identities, sdk, preparer } = fixture();
  sdk.listProfiles.mockRejectedValue(
    Object.assign(new Error("private-sdk-sentinel"), { code: "RUNTIME_NOT_INSTALLED" }),
  );
  await expect(preparer.prepareStored(input, identities)).resolves.toEqual({
    status: "failed_before_spawn",
    failureCode: "RUNTIME_NOT_INSTALLED",
  });
  expect(identities.findById).toHaveBeenCalledExactlyOnceWith(identityId);
  expectPreparationOnly(sdk);
});

test.each([
  ["broken JSON", "{invalid", 1],
  ["unsupported format", JSON.stringify(config), 2],
] as const)(
  "rejects %s from an actual damaged SQLite fixture",
  async (_, configJson, version) => {
    await withDatabase(async (database) => {
      // Bypass CHECK only in this temporary database to simulate damaged storage.
      await sql`PRAGMA ignore_check_constraints = ON`.execute(database);
      try {
        await database
          .insertInto("fingerprint_identities")
          .values({
            id: identityId,
            format_version: version,
            config_json: configJson,
            created_at: timestamp,
          })
          .execute();
      } finally {
        await sql`PRAGMA ignore_check_constraints = OFF`.execute(database);
      }
      const { input, sdk, preparer } = fixture();
      const source = new SqliteFingerprintIdentityRepository(database);
      await expect(preparer.prepareStored(input, source)).resolves.toEqual(unavailable);
      const row = await database
        .selectFrom("fingerprint_identities")
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(row.config_json).toBe(configJson);
      expect(row.format_version).toBe(version);
      await expect(
        database.selectFrom("profiles").selectAll().execute(),
      ).resolves.toEqual([]);
      expect(sdk.listProfiles).not.toHaveBeenCalled();
      expectPreparationOnly(sdk);
    });
  },
);

test("creates once and prepares new runs from the same configuration after reopening SQLite", async () => {
  const root = await mkdtemp(join(tmpdir(), "antidetect-stored-preparation-reopen-"));
  const paths = resolveAppPaths({ env: { ANTIDETECT_HOME: root } });
  const sdk = forbiddenSdkOperations();
  const generator = {
    generate: vi.fn<FingerprintGenerator["generate"]>().mockResolvedValue(config),
  };
  try {
    for (const round of [0, 1] as const) {
      const owner = acquireRootOwnership(join(root, "antidetect.sqlite"));
      const database = createAppDatabase(owner);
      try {
        await runMigrations(database);
        const profiles = new SqliteProfileRepository(database);
        const identities = new SqliteFingerprintIdentityRepository(database);
        if (round === 0) {
          const service = new ProfileCreationService(profiles, generator, {
            createId: vi
              .fn<() => string>()
              .mockReturnValueOnce(profileId)
              .mockReturnValueOnce(identityId),
            now: () => timestamp,
          });
          await service.create({
            displayName: "Research profile",
            fingerprintEnabled: true,
          });
        }
        const profile = await profiles.findById(profileId);
        if (profile === null) throw new Error("Expected stored profile");
        const result = await new ShardXLaunchPreparer(paths, sdk).prepareStored(
          {
            runId: runIds[round],
            profileId: profile.id,
            profileDirectory: join(paths.profilesDir, profile.id),
            identityRef: profile.identityRef,
          },
          identities,
        );
        expect(result.status).toBe("prepared");
        if (result.status !== "prepared") throw new Error("Expected prepared input");
        expect(result.profile.id).toBe(profileId);
        expect(result.profile.config).toEqual(config);
        expect(result.options).toEqual({
          userDataDir: join(paths.profilesDir, profileId),
          randomize: false,
          headless: false,
          cdp: true,
        });
        result.profile.config.navigator = { platform: "Modified working copy" };
        await expect(identities.findById(identityId)).resolves.toEqual(identity);
        await expect(
          database.selectFrom("profile_code_sequence").selectAll().execute(),
        ).resolves.toEqual([{ id: 1, next_value: 2 }]);
        await expect(
          database.selectFrom("fingerprint_identities").select("id").execute(),
        ).resolves.toEqual([{ id: identityId }]);
      } finally {
        await database.destroy();
        owner.close();
      }
    }
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(sdk.listProfiles).toHaveBeenCalledTimes(2);
    expectPreparationOnly(sdk);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
