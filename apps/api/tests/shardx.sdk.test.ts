import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { resolveAppPaths, type AppPaths } from "../src/config/app.paths.ts";
import { createShardXSdk } from "../src/infrastructure/runtime/shardx.sdk.ts";

const temporaryPrefix = "antidetect-shardx-sdk-";
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    if (
      dirname(root) !== resolve(tmpdir()) ||
      !basename(root).startsWith(temporaryPrefix)
    ) {
      throw new Error("Refusing to remove a directory outside the SDK test fixtures");
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(): Promise<{
  root: string;
  paths: AppPaths;
  sdk: ReturnType<typeof createShardXSdk>;
}> {
  const root = await mkdtemp(join(tmpdir(), temporaryPrefix));
  temporaryRoots.push(root);
  const paths = resolveAppPaths({ env: { ANTIDETECT_HOME: root } });
  return { root, paths, sdk: createShardXSdk(paths) };
}

test("SDK construction uses V2 paths without creating runtime files", async () => {
  const { root, paths, sdk } = await fixture();
  expect(sdk.runtime.root).toBe(paths.runtimeDir);
  expect(await readdir(root)).toEqual([]);

  // Reading profilesRoot creates the configured directory in the SDK.
  expect(sdk.runtime.profilesRoot).toBe(paths.profilesDir);
  expect(await readdir(root)).toEqual(["profiles"]);
});

test.each(["missing", "empty"] as const)(
  "%s runtime is rejected without implicit installation or file creation",
  async (cacheState) => {
    const { root, paths, sdk } = await fixture();
    if (cacheState === "empty") {
      await mkdir(paths.runtimeDir);
    }
    const install = vi
      .spyOn(sdk.runtime, "install")
      .mockRejectedValue(new Error("Engine installation is forbidden in this test"));

    await expect(sdk.listProfiles()).rejects.toMatchObject({
      code: "RUNTIME_NOT_INSTALLED",
    });
    expect(install).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(cacheState === "empty" ? ["runtime"] : []);
    if (cacheState === "empty") {
      expect(await readdir(paths.runtimeDir)).toEqual([]);
    }
  },
);

test("partial runtime is rejected without repairing its files", async () => {
  const { root, paths, sdk } = await fixture();
  await mkdir(paths.runtimeDir);
  const metadataPath = join(paths.runtimeDir, "manifest.json");
  await writeFile(metadataPath, "{}");
  const install = vi
    .spyOn(sdk.runtime, "install")
    .mockRejectedValue(new Error("Engine installation is forbidden in this test"));

  await expect(sdk.listProfiles()).rejects.toMatchObject({
    code: "RUNTIME_NOT_INSTALLED",
  });
  expect(install).not.toHaveBeenCalled();
  expect(await readFile(metadataPath, "utf8")).toBe("{}");
  expect(await readdir(paths.runtimeDir)).toEqual(["manifest.json"]);
  expect(await readdir(root)).toEqual(["runtime"]);
});

test("unfinished runtime update is rejected without removing its recovery marker", async () => {
  const { root, paths, sdk } = await fixture();
  await mkdir(paths.runtimeDir);
  const markerPath = join(paths.runtimeDir, ".runtime-update-recovery");
  await writeFile(markerPath, "unfinished update fixture");
  const install = vi
    .spyOn(sdk.runtime, "install")
    .mockRejectedValue(new Error("Engine installation is forbidden in this test"));

  await expect(sdk.listProfiles()).rejects.toMatchObject({
    code: "RUNTIME_NOT_INSTALLED",
  });
  expect(install).not.toHaveBeenCalled();
  expect(await readFile(markerPath, "utf8")).toBe("unfinished update fixture");
  expect(await readdir(paths.runtimeDir)).toEqual([".runtime-update-recovery"]);
  expect(await readdir(root)).toEqual(["runtime"]);
});
