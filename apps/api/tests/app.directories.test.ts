import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { ensureAppDirectories } from "../src/infrastructure/filesystem/app.directories.ts";

async function createTestPaths() {
  const rootDir = await fs.mkdtemp(join(tmpdir(), "antidetect-app-directories-"));

  return {
    rootDir,
    paths: resolveAppPaths({ env: { ANTIDETECT_HOME: rootDir } }),
  };
}

test("creates all application directories", async () => {
  const { rootDir, paths } = await createTestPaths();

  try {
    await ensureAppDirectories(paths);

    for (const directory of [
      paths.configDir,
      paths.dataDir,
      paths.profilesDir,
      paths.runtimeDir,
      paths.logsDir,
    ]) {
      expect((await fs.stat(directory)).isDirectory()).toBe(true);
    }
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("is idempotent for existing application directories", async () => {
  const { rootDir, paths } = await createTestPaths();

  try {
    await ensureAppDirectories(paths);
    await expect(ensureAppDirectories(paths)).resolves.toBeUndefined();
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("does not replace a file where a directory is required", async () => {
  const { rootDir, paths } = await createTestPaths();
  const marker = "keep this file";

  try {
    await fs.writeFile(paths.configDir, marker, "utf8");

    await expect(ensureAppDirectories(paths)).rejects.toMatchObject({
      code: expect.stringMatching(/EEXIST|ENOTDIR/),
    });
    await expect(fs.readFile(paths.configDir, "utf8")).resolves.toBe(marker);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("keeps separate application roots isolated", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-app-isolation-"));
  const rootA = join(tempRoot, "root-a");
  const rootB = join(tempRoot, "root-b");
  const userLocalAppData = join(tempRoot, "user-localappdata-sentinel");
  const pathsA = resolveAppPaths({
    env: {
      ANTIDETECT_HOME: rootA,
      LOCALAPPDATA: userLocalAppData,
    },
  });
  const pathsB = resolveAppPaths({
    env: {
      ANTIDETECT_HOME: rootB,
      LOCALAPPDATA: userLocalAppData,
    },
  });

  try {
    await ensureAppDirectories(pathsA);
    await ensureAppDirectories(pathsB);

    const markerA = join(pathsA.profilesDir, "root-a.marker");
    const markerB = join(pathsB.profilesDir, "root-b.marker");

    await fs.writeFile(markerA, "root-a", "utf8");
    expect(await fs.readFile(markerA, "utf8")).toBe("root-a");
    await expect(
      fs.access(join(pathsB.profilesDir, "root-a.marker")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await fs.writeFile(markerB, "root-b", "utf8");
    expect(await fs.readFile(markerB, "utf8")).toBe("root-b");
    await expect(
      fs.access(join(pathsA.profilesDir, "root-b.marker")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    expect(pathsA.rootDir).not.toBe(pathsB.rootDir);
    expect(pathsA.rootDir).not.toContain(userLocalAppData);
    expect(pathsB.rootDir).not.toContain(userLocalAppData);
    await expect(fs.access(userLocalAppData)).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
