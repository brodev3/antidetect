import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Profile, Runtime, ShardX } from "@proxyshard/shardx";
import { afterEach, expect, test, vi } from "vitest";
import {
  FingerprintGenerationError,
  type FingerprintPlatform,
  type FingerprintGenerator,
} from "../src/application/fingerprints/fingerprint.generator.ts";
import { InvalidFingerprintIdentityError } from "../src/application/fingerprints/fingerprint.identity.errors.ts";
import { MAX_FINGERPRINT_CONFIG_BYTES } from "../src/application/fingerprints/fingerprint.identity.repository.ts";
import { resolveAppPaths, type AppPaths } from "../src/config/app.paths.ts";
import {
  ShardXFingerprintGenerator,
  type ShardXFingerprintRandomizers,
  type ShardXFingerprintSource,
} from "../src/infrastructure/runtime/shardx.fingerprint.generator.ts";

const identityId = "5625c842-282d-42aa-a8b2-f06e79d50e6f";
const secondIdentityId = "cf7c7db4-0b0b-470d-b0ca-2866505e95a1";
const temporaryPrefix = "antidetect-shardx-fingerprint-";
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    if (
      dirname(root) !== resolve(tmpdir()) ||
      !basename(root).startsWith(temporaryPrefix)
    ) {
      throw new Error("Refusing to remove a directory outside fingerprint fixtures");
    }
    await rm(root, { recursive: true, force: true });
  }
});

function fixture(
  paths: Pick<AppPaths, "runtimeDir" | "profilesDir"> = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tmpdir(), "antidetect-fingerprint-mock") },
  }),
  platform: FingerprintPlatform = "Windows",
  templateId = "windows-template",
) {
  const template = {
    name: templateId,
    navigator: {
      platform,
      platform_version: "10.0.0",
      hardware_concurrency: 4,
      device_memory: 8,
      languages: ["en-US"],
    },
    client_hints: { platform, platform_version: "10.0.0" },
    screen: { width: 1920, height: 1080 },
  };
  const source = {
    randomProfile: vi
      .fn<ShardXFingerprintSource["randomProfile"]>()
      .mockResolvedValue({ id: templateId, config: template }),
    createProfile: vi.fn(),
    saveProfile: vi.fn(),
    launch: vi.fn(),
    session: vi.fn(),
    install: vi.fn(),
  };
  const randomizers = {
    hardware: vi
      .fn<ShardXFingerprintRandomizers["hardware"]>()
      .mockImplementation((config) => {
        const navigator = config.navigator as Record<string, unknown>;
        navigator.hardware_concurrency = 8;
        navigator.device_memory = 16;
      }),
    platformVersion: vi
      .fn<ShardXFingerprintRandomizers["platformVersion"]>()
      .mockImplementation((config) => {
        const navigator = config.navigator as Record<string, unknown>;
        const hints = config.client_hints as Record<string, unknown>;
        navigator.platform_version = "17.0.0";
        hints.platform_version = "17.0.0";
      }),
  };
  const generator = new ShardXFingerprintGenerator(paths, source, randomizers);
  return { paths, template, source, randomizers, generator, templateId };
}

test("generates plain Windows config and runs SDK randomizers exactly once in order", async () => {
  const { template, source, randomizers, generator, templateId } = fixture();
  const original = structuredClone(template);
  const port: FingerprintGenerator = generator;
  const config = await port.generate(identityId);

  expect(source.randomProfile).toHaveBeenCalledExactlyOnceWith({ platform: "Windows" });
  expect(randomizers.hardware).toHaveBeenCalledTimes(1);
  expect(randomizers.hardware.mock.calls[0]?.[1]).toBe(templateId);
  expect(randomizers.platformVersion).toHaveBeenCalledTimes(1);
  expect(randomizers.hardware.mock.invocationCallOrder[0]).toBeLessThan(
    randomizers.platformVersion.mock.invocationCallOrder[0]!,
  );
  expect(config).toEqual({
    ...original,
    navigator: {
      ...original.navigator,
      platform_version: "17.0.0",
      hardware_concurrency: 8,
      device_memory: 16,
    },
    client_hints: { ...original.client_hints, platform_version: "17.0.0" },
  });
  expect(config).not.toBeInstanceOf(Profile);
  expect(Object.getPrototypeOf(config)).toBe(Object.prototype);
  expect(template).toEqual(original);
  for (const forbidden of [
    source.createProfile,
    source.saveProfile,
    source.launch,
    source.session,
    source.install,
  ]) {
    expect(forbidden).not.toHaveBeenCalled();
  }
});

test.each(["Windows", "macOS", "Linux"] as const)(
  "generates and validates a %s config",
  async (platform) => {
    const templateId =
      platform === "macOS" ? "mac-m1-air13" : `${platform.toLowerCase()}-template`;
    const { source, randomizers, generator } = fixture(undefined, platform, templateId);

    await expect(generator.generate(identityId, platform)).resolves.toMatchObject({
      navigator: { platform },
      client_hints: { platform },
    });
    expect(source.randomProfile).toHaveBeenCalledExactlyOnceWith({ platform });
    expect(randomizers.hardware).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      templateId,
    );
  },
);

test("rejects a generated config that does not match the requested platform", async () => {
  const { randomizers, generator } = fixture();

  await expect(generator.generate(identityId, "macOS")).rejects.toMatchObject({
    code: "FINGERPRINT_GENERATION_FAILED",
  });
  expect(randomizers.hardware).not.toHaveBeenCalled();
});

test("rejects client hints that do not match the requested platform", async () => {
  const { template, source, randomizers, generator, templateId } = fixture(
    undefined,
    "macOS",
    "mac-m1-air13",
  );
  source.randomProfile.mockResolvedValue({
    id: templateId,
    config: {
      ...template,
      client_hints: { ...template.client_hints, platform: "Windows" },
    },
  });

  await expect(generator.generate(identityId, "macOS")).rejects.toMatchObject({
    code: "FINGERPRINT_GENERATION_FAILED",
  });
  expect(randomizers.hardware).not.toHaveBeenCalled();
});

test("does not create any files during successful generation with a substituted SDK", async () => {
  const root = await mkdtemp(join(tmpdir(), temporaryPrefix));
  temporaryRoots.push(root);
  const paths = resolveAppPaths({ env: { ANTIDETECT_HOME: root } });
  await expect(fixture(paths).generator.generate(identityId)).resolves.toHaveProperty(
    "navigator.platform",
    "Windows",
  );
  expect(await readdir(root)).toEqual([]);
});

test("works with a frozen template and detaches both nested input and SDK working copies", async () => {
  const { template, randomizers, generator } = fixture();
  Object.freeze(template.navigator.languages);
  Object.freeze(template.navigator);
  Object.freeze(template.client_hints);
  Object.freeze(template.screen);
  Object.freeze(template);
  const result = await generator.generate(identityId);
  const working = randomizers.hardware.mock.calls[0]?.[0];
  if (working === undefined) throw new Error("Expected hardware working copy");
  expect(result.navigator).not.toBe(template.navigator);
  expect(result.navigator).not.toBe(working.navigator);
  const workingNavigator = working.navigator as Record<string, unknown>;
  workingNavigator.hardware_concurrency = 64;
  (workingNavigator.languages as string[]).push("changed-in-sdk");
  expect(result.navigator).toMatchObject({
    hardware_concurrency: 8,
    languages: ["en-US"],
  });
  expect(template.navigator).toMatchObject({
    hardware_concurrency: 4,
    languages: ["en-US"],
  });
});

test("separate generations do not share mutable config", async () => {
  const { template, source, randomizers, generator, templateId } = fixture();
  const first = await generator.generate(identityId);
  (first.navigator as Record<string, unknown>).platform_version = "changed-by-caller";
  const second = await generator.generate(secondIdentityId);
  expect(second.navigator).toMatchObject({
    platform: "Windows",
    platform_version: "17.0.0",
  });
  expect(second).not.toBe(first);
  expect(second.navigator).not.toBe(first.navigator);
  expect(template.navigator.platform_version).toBe("10.0.0");
  expect(source.randomProfile).toHaveBeenCalledTimes(2);
  expect(randomizers.hardware).toHaveBeenNthCalledWith(
    2,
    expect.any(Object),
    templateId,
  );
  expect(randomizers.platformVersion).toHaveBeenCalledTimes(2);
});

test.each(["", "test-identity:fixture", "not-a-uuid"])(
  "rejects invalid identity id %s before using the SDK",
  async (invalidId) => {
    const { source, randomizers, generator } = fixture();
    await expect(generator.generate(invalidId)).rejects.toEqual(
      new InvalidFingerprintIdentityError(),
    );
    expect(source.randomProfile).not.toHaveBeenCalled();
    expect(randomizers.hardware).not.toHaveBeenCalled();
    expect(randomizers.platformVersion).not.toHaveBeenCalled();
  },
);

const invalidConfigs: readonly { label: string; config: unknown }[] = [
  { label: "empty config", config: {} },
  { label: "array", config: [] },
  { label: "null", config: null },
  { label: "missing platform", config: { navigator: {} } },
  { label: "Linux", config: { navigator: { platform: "Linux" } } },
  {
    label: "Win32 instead of the SDK platform name",
    config: { navigator: { platform: "Win32" } },
  },
  {
    label: "undefined",
    config: { navigator: { platform: "Windows" }, value: undefined },
  },
  { label: "NaN", config: { navigator: { platform: "Windows" }, value: Number.NaN } },
  {
    label: "function",
    config: { navigator: { platform: "Windows" }, value: () => "do-not-leak" },
  },
];

test.each(invalidConfigs)(
  "rejects source $label before randomization",
  async ({ config }) => {
    const { source, randomizers, generator } = fixture();
    source.randomProfile.mockResolvedValue({
      id: "windows-template",
      config: config as Record<string, unknown>,
    });
    await expect(generator.generate(identityId)).rejects.toEqual(
      new FingerprintGenerationError("FINGERPRINT_GENERATION_FAILED"),
    );
    expect(randomizers.hardware).not.toHaveBeenCalled();
    expect(randomizers.platformVersion).not.toHaveBeenCalled();
  },
);

test("cycles and throwing config getters return a fixed error", async () => {
  const { source, randomizers, generator } = fixture();
  const cycle: Record<string, unknown> = { navigator: { platform: "Windows" } };
  cycle.self = cycle;
  const throwing = {
    get navigator(): string {
      throw new Error("do-not-leak");
    },
  };
  for (const config of [cycle, throwing]) {
    source.randomProfile.mockResolvedValue({ id: "windows-template", config });
    await expect(generator.generate(identityId)).rejects.toEqual(
      new FingerprintGenerationError("FINGERPRINT_GENERATION_FAILED"),
    );
  }
  expect(randomizers.hardware).not.toHaveBeenCalled();
});

test.each(["missing-runtime", "sdk-failure"])(
  "sanitizes $label errors",
  async (failure) => {
    const { source, randomizers, generator } = fixture();
    const code =
      failure === "missing-runtime" ? "RUNTIME_NOT_INSTALLED" : "PRIVATE_SDK_FAILURE";
    source.randomProfile.mockRejectedValue(
      Object.assign(new Error("do-not-leak"), { code }),
    );
    await expect(generator.generate(identityId)).rejects.toEqual(
      new FingerprintGenerationError(
        failure === "missing-runtime"
          ? "RUNTIME_NOT_INSTALLED"
          : "FINGERPRINT_GENERATION_FAILED",
      ),
    );
    expect(randomizers.hardware).not.toHaveBeenCalled();
    expect(randomizers.platformVersion).not.toHaveBeenCalled();
  },
);

test("error code accessors and proxy traps cannot leak exceptions or be invoked as getters", async () => {
  const { source, generator } = fixture();
  const codeGetter = vi.fn(() => {
    throw new Error("do-not-leak");
  });
  const withAccessor = Object.defineProperty(new Error("do-not-leak"), "code", {
    get: codeGetter,
  });
  const withTrap = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error("do-not-leak");
      },
    },
  );
  for (const error of [withAccessor, withTrap]) {
    source.randomProfile.mockRejectedValue(error);
    await expect(generator.generate(identityId)).rejects.toEqual(
      new FingerprintGenerationError("FINGERPRINT_GENERATION_FAILED"),
    );
  }
  expect(codeGetter).not.toHaveBeenCalled();
});

test.each(["hardware", "platformVersion"] as const)(
  "sanitizes failure in %s randomization",
  async (step) => {
    const { template, randomizers, generator } = fixture();
    const original = structuredClone(template);
    randomizers[step].mockImplementation(() => {
      throw new Error("do-not-leak");
    });
    await expect(generator.generate(identityId)).rejects.toEqual(
      new FingerprintGenerationError("FINGERPRINT_GENERATION_FAILED"),
    );
    expect(template).toEqual(original);
    if (step === "hardware") expect(randomizers.platformVersion).not.toHaveBeenCalled();
  },
);

test.each([
  {
    label: "non-JSON value",
    mutate: (config: Record<string, unknown>): void => {
      config.invalid = Number.NaN;
    },
  },
  {
    label: "different platform",
    mutate: (config: Record<string, unknown>): void => {
      config.navigator = { platform: "Linux" };
    },
  },
  {
    label: "oversized output",
    mutate: (config: Record<string, unknown>): void => {
      config.padding = "ж".repeat(MAX_FINGERPRINT_CONFIG_BYTES / 2);
    },
  },
])("rejects randomizer $label without changing the source", async ({ mutate }) => {
  const { template, randomizers, generator } = fixture();
  const original = structuredClone(template);
  randomizers.platformVersion.mockImplementation(mutate);
  await expect(generator.generate(identityId)).rejects.toEqual(
    new FingerprintGenerationError("FINGERPRINT_GENERATION_FAILED"),
  );
  expect(template).toEqual(original);
});

test("accepts exactly 1 MiB and rejects oversized UTF-8 source config", async () => {
  const { source, randomizers, generator } = fixture();
  randomizers.hardware.mockImplementation(() => {});
  randomizers.platformVersion.mockImplementation(() => {});
  const base = { navigator: { platform: "Windows" }, padding: "" };
  const overhead = Buffer.byteLength(JSON.stringify(base), "utf8");
  const exact = {
    ...base,
    padding: "a".repeat(MAX_FINGERPRINT_CONFIG_BYTES - overhead),
  };
  source.randomProfile.mockResolvedValue({ id: "windows-template", config: exact });
  const generated = await generator.generate(identityId);
  expect(Buffer.byteLength(JSON.stringify(generated), "utf8")).toBe(
    MAX_FINGERPRINT_CONFIG_BYTES,
  );
  expect(randomizers.hardware).toHaveBeenCalledTimes(1);
  const oversized = { ...base, padding: "ж".repeat(MAX_FINGERPRINT_CONFIG_BYTES / 2) };
  expect(JSON.stringify(oversized).length).toBeLessThan(MAX_FINGERPRINT_CONFIG_BYTES);
  source.randomProfile.mockResolvedValue({ id: "windows-template", config: oversized });
  await expect(generator.generate(secondIdentityId)).rejects.toEqual(
    new FingerprintGenerationError("FINGERPRINT_GENERATION_FAILED"),
  );
  expect(randomizers.hardware).toHaveBeenCalledTimes(1);
  expect(randomizers.platformVersion).toHaveBeenCalledTimes(1);
});

test.each(["missing", "empty"] as const)(
  "the default SDK rejects %s installation without downloads or writes",
  async (installation) => {
    const root = await mkdtemp(join(tmpdir(), temporaryPrefix));
    temporaryRoots.push(root);
    const paths = resolveAppPaths({ env: { ANTIDETECT_HOME: root } });
    if (installation === "empty") await mkdir(paths.runtimeDir);
    const forbidden = (): never => {
      throw new Error("Forbidden SDK operation in this test");
    };
    const install = vi
      .spyOn(Runtime.prototype, "install")
      .mockImplementation(forbidden);
    const createProfile = vi
      .spyOn(ShardX.prototype, "createProfile")
      .mockImplementation(forbidden);
    const saveProfile = vi
      .spyOn(ShardX.prototype, "saveProfile")
      .mockImplementation(forbidden);
    const launch = vi.spyOn(ShardX.prototype, "launch").mockImplementation(forbidden);
    const session = vi.spyOn(ShardX.prototype, "session").mockImplementation(forbidden);
    await expect(
      new ShardXFingerprintGenerator(paths).generate(identityId),
    ).rejects.toEqual(new FingerprintGenerationError("RUNTIME_NOT_INSTALLED"));
    for (const operation of [install, createProfile, saveProfile, launch, session]) {
      expect(operation).not.toHaveBeenCalled();
    }
    expect(await readdir(root)).toEqual(installation === "empty" ? ["runtime"] : []);
    if (installation === "empty") expect(await readdir(paths.runtimeDir)).toEqual([]);
  },
);
