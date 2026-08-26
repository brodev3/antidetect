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
