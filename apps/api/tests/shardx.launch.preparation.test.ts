import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Runtime } from "@proxyshard/shardx";
import { afterEach, expect, test, vi } from "vitest";
import type { RuntimeLaunchInput } from "../src/application/runtime/browser.runtime.ts";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import {
  ShardXLaunchPreparer,
  type ShardXLaunchFingerprint,
} from "../src/infrastructure/runtime/shardx.launch.preparation.ts";

const profileId = "550e8400-e29b-41d4-a716-446655440000";
const runId = "5baa51af-9c91-47a9-bac1-f79e03f32d3b";
const temporaryPrefix = "antidetect-shardx-preparation-";
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    if (
      dirname(root) !== resolve(tmpdir()) ||
      !basename(root).startsWith(temporaryPrefix)
    ) {
      throw new Error("Refusing to remove a directory outside preparation fixtures");
    }
    await rm(root, { recursive: true, force: true });
  }
});

function fixture(): {
  sdk: {
    listProfiles: ReturnType<typeof vi.fn<() => Promise<string[]>>>;
    launch: ReturnType<typeof vi.fn>;
    session: ReturnType<typeof vi.fn>;
    createProfile: ReturnType<typeof vi.fn>;
    randomProfile: ReturnType<typeof vi.fn>;
  };
  input: RuntimeLaunchInput;
  fingerprint: ShardXLaunchFingerprint;
  preparer: ShardXLaunchPreparer;
} {
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tmpdir(), "antidetect-preparation-mock") },
  });
  const sdk = {
    listProfiles: vi.fn<() => Promise<string[]>>().mockResolvedValue(["template"]),
    launch: vi.fn(),
    session: vi.fn(),
    createProfile: vi.fn(),
    randomProfile: vi.fn(),
  };
  return {
    sdk,
    input: {
      profileId,
      runId,
      profileDirectory: join(paths.profilesDir, profileId),
      identityRef: "fingerprint:immutable-fixture",
    },
    fingerprint: {
      identityRef: "fingerprint:immutable-fixture",
      config: {
        name: "not-an-application-profile-id",
        navigator: { platform: "Win32", hardware_concurrency: 8 },
      },
    },
    preparer: new ShardXLaunchPreparer(paths, sdk),
  };
}

test("prepares the exact application profile without launching or creating an SDK profile", async () => {
  const { sdk, input, fingerprint, preparer } = fixture();
  const result = await preparer.prepare(input, fingerprint);

  expect(result.status).toBe("prepared");
  if (result.status !== "prepared") throw new Error("Expected prepared input");
  expect(result.profile.id).toBe(profileId);
  expect(result.profile.config).toEqual(fingerprint.config);
  expect(result.options).toEqual({
    userDataDir: input.profileDirectory,
    randomize: false,
    headless: false,
    cdp: true,
  });
  expect(sdk.listProfiles).toHaveBeenCalledExactlyOnceWith();
  expect(sdk.launch).not.toHaveBeenCalled();
  expect(sdk.session).not.toHaveBeenCalled();
  expect(sdk.createProfile).not.toHaveBeenCalled();
  expect(sdk.randomProfile).not.toHaveBeenCalled();
  expect(result).not.toHaveProperty("process");

  result.profile.config.navigator = { platform: "mutated SDK working copy" };
  expect(fingerprint.config.navigator).toEqual({
    platform: "Win32",
    hardware_concurrency: 8,
  });
});

test("a new run keeps the same frozen identity and profile directory", async () => {
  const { input, fingerprint, preparer } = fixture();
  const first = await preparer.prepare(input, fingerprint);
  const second = await preparer.prepare(
    { ...input, runId: "6f27d182-3ce5-4547-b82b-88b3cf482aa3" },
    fingerprint,
  );
  expect(first.status).toBe("prepared");
  expect(second.status).toBe("prepared");
  if (first.status !== "prepared" || second.status !== "prepared") {
    throw new Error("Expected two prepared inputs");
  }
  expect(second.profile.id).toBe(first.profile.id);
  expect(second.profile.config).toEqual(first.profile.config);
  expect(second.options).toEqual(first.options);
  expect(second.profile).not.toBe(first.profile);
});

test("snapshots the fingerprint before an asynchronous readiness check", async () => {
  const { sdk, input, fingerprint, preparer } = fixture();
  let finishReadiness: (ids: string[]) => void = () => {
    throw new Error("Readiness did not start");
  };
  sdk.listProfiles.mockImplementation(
    () =>
      new Promise<string[]>((resolveReady) => {
        finishReadiness = resolveReady;
      }),
  );
  const preparation = preparer.prepare(input, fingerprint);
  const navigator = fingerprint.config.navigator as Record<string, unknown>;
  navigator.platform = "modified while awaiting readiness";
  finishReadiness(["template"]);
  const result = await preparation;
  expect(result.status).toBe("prepared");
  if (result.status !== "prepared") throw new Error("Expected prepared input");
  expect(result.profile.config.navigator).toEqual({
    platform: "Win32",
    hardware_concurrency: 8,
  });
});

test.each([
  ["invalid profile UUID", { profileId: "../../another-profile" }],
  ["invalid run UUID", { runId: "not-a-run-id" }],
  ["relative directory", { profileDirectory: "relative-profile" }],
  ["outside directory", { profileDirectory: resolve(tmpdir()) }],
  ["NUL directory", { profileDirectory: `${resolve(tmpdir())}\0` }],
] as const)("rejects %s before calling the SDK", async (_label, overrides) => {
  const { sdk, input, fingerprint, preparer } = fixture();
  await expect(
    preparer.prepare({ ...input, ...overrides }, fingerprint),
  ).resolves.toEqual({
    status: "failed_before_spawn",
    failureCode: "RUNTIME_LAUNCH_INPUT_INVALID",
  });
  expect(sdk.listProfiles).not.toHaveBeenCalled();
});

test("rejects another profile's UUID directory even under the configured root", async () => {
  const { sdk, input, fingerprint, preparer } = fixture();
  const profileDirectory = join(dirname(input.profileDirectory), runId);
  await expect(
    preparer.prepare({ ...input, profileDirectory }, fingerprint),
  ).resolves.toEqual({
    status: "failed_before_spawn",
    failureCode: "RUNTIME_LAUNCH_INPUT_INVALID",
  });
  expect(sdk.listProfiles).not.toHaveBeenCalled();
});

test("does not silently substitute an empty fingerprint for disabled mode", async () => {
  const { sdk, input, fingerprint, preparer } = fixture();
  await expect(
    preparer.prepare({ ...input, identityRef: null }, fingerprint),
  ).resolves.toEqual({
    status: "failed_before_spawn",
    failureCode: "RUNTIME_FINGERPRINT_MODE_UNSUPPORTED",
  });
  expect(sdk.listProfiles).not.toHaveBeenCalled();
});

test.each(["", "test-identity:fixture"])(
  "rejects placeholder identity %j",
  async (identityRef) => {
    const { sdk, input, fingerprint, preparer } = fixture();
    await expect(
      preparer.prepare({ ...input, identityRef }, { ...fingerprint, identityRef }),
    ).resolves.toEqual({
      status: "failed_before_spawn",
      failureCode: "RUNTIME_FINGERPRINT_UNAVAILABLE",
    });
    expect(sdk.listProfiles).not.toHaveBeenCalled();
  },
);

test.each([null, { identityRef: "another-identity", config: { name: "fixture" } }])(
  "rejects missing or mismatched fingerprint %j",
  async (fingerprint) => {
    const { sdk, input, preparer } = fixture();
    await expect(preparer.prepare(input, fingerprint)).resolves.toEqual({
      status: "failed_before_spawn",
      failureCode: "RUNTIME_FINGERPRINT_UNAVAILABLE",
    });
    expect(sdk.listProfiles).not.toHaveBeenCalled();
  },
);

test.each([{}, { invalid: 1n }, { invalid: undefined }])(
  "rejects empty or non-JSON fingerprint configuration",
  async (config) => {
    const { sdk, input, fingerprint, preparer } = fixture();
    await expect(preparer.prepare(input, { ...fingerprint, config })).resolves.toEqual({
      status: "failed_before_spawn",
      failureCode: "RUNTIME_FINGERPRINT_UNAVAILABLE",
    });
    expect(sdk.listProfiles).not.toHaveBeenCalled();
  },
);

test.each([
  [
    Object.assign(new Error("sensitive SDK diagnostic"), {
      code: "RUNTIME_NOT_INSTALLED",
    }),
    "RUNTIME_NOT_INSTALLED",
  ],
  [
    Object.assign(new Error("sensitive SDK diagnostic"), {
      code: "VENDOR_INTERNAL_DETAIL",
    }),
    "RUNTIME_PREPARATION_FAILED",
  ],
  [new Error("sensitive SDK diagnostic"), "RUNTIME_PREPARATION_FAILED"],
  ["sensitive SDK diagnostic", "RUNTIME_PREPARATION_FAILED"],
] as const)(
  "maps readiness errors to a safe pre-spawn result",
  async (error, failureCode) => {
    const { sdk, input, fingerprint, preparer } = fixture();
    sdk.listProfiles.mockRejectedValue(error);
    await expect(preparer.prepare(input, fingerprint)).resolves.toEqual({
      status: "failed_before_spawn",
      failureCode,
    });
    expect(sdk.launch).not.toHaveBeenCalled();
  },
);

test("the default real SDK rejects missing assets without installing or creating files", async () => {
  const root = await mkdtemp(join(tmpdir(), temporaryPrefix));
  temporaryRoots.push(root);
  const paths = resolveAppPaths({ env: { ANTIDETECT_HOME: root } });
  const install = vi
    .spyOn(Runtime.prototype, "install")
    .mockRejectedValue(
      new Error("Engine installation is forbidden in preparation tests"),
    );
  const { input, fingerprint } = fixture();
  const preparer = new ShardXLaunchPreparer(paths);
  await expect(
    preparer.prepare(
      { ...input, profileDirectory: join(paths.profilesDir, profileId) },
      fingerprint,
    ),
  ).resolves.toEqual({
    status: "failed_before_spawn",
    failureCode: "RUNTIME_NOT_INSTALLED",
  });
  expect(install).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual([]);
});
