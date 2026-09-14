import { promises as fs } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { ensureAppRootDirectories } from "../src/infrastructure/filesystem/app.directories.ts";
import {
  acquireRootOwnership,
  AppRootInUseError,
} from "../src/infrastructure/sqlite/root.ownership.ts";

async function createRootPaths() {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-root-ownership-"));
  const rootDir = join(tempRoot, "app");

  return {
    tempRoot,
    paths: resolveAppPaths({ env: { ANTIDETECT_HOME: rootDir } }),
  };
}

const ownerFixturePath = fileURLToPath(
  new URL("./fixtures/root-owner.mjs", import.meta.url),
);

function waitForOutput(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";

    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.includes(expected)) {
        cleanup();
        resolve();
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Child exited before output with code ${code}: ${output}`));
    };
    const cleanup = () => {
      child.stdout?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    child.stdout?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode);
  }

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      resolve(code);
    };
    const cleanup = () => {
      child.off("error", onError);
      child.off("exit", onExit);
    };

    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function spawnOwner(databasePath: string): ChildProcess {
  return spawn(process.execPath, [ownerFixturePath, databasePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("rejects a second owner of the same application root", async () => {
  const { tempRoot, paths } = await createRootPaths();
  await ensureAppRootDirectories(paths);
  const owner = acquireRootOwnership(paths.databasePath);

  try {
    expect(() => acquireRootOwnership(paths.databasePath)).toThrow(AppRootInUseError);
  } finally {
    owner.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("releases the root for a later owner", async () => {
  const { tempRoot, paths } = await createRootPaths();
  await ensureAppRootDirectories(paths);

  const firstOwner = acquireRootOwnership(paths.databasePath);
  firstOwner.close();

  const secondOwner = acquireRootOwnership(paths.databasePath);
  secondOwner.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("allows independent roots to be owned at the same time", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-root-isolation-"));
  const pathsA = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "root-a") },
  });
  const pathsB = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "root-b") },
  });

  await ensureAppRootDirectories(pathsA);
  await ensureAppRootDirectories(pathsB);

  const ownerA = acquireRootOwnership(pathsA.databasePath);
  const ownerB = acquireRootOwnership(pathsB.databasePath);

  ownerA.close();
  ownerB.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("enforces ownership across OS processes", async () => {
  const { tempRoot, paths } = await createRootPaths();
  await ensureAppRootDirectories(paths);

  const firstOwner = spawnOwner(paths.databasePath);
  let reopenedOwner: ChildProcess | undefined;

  try {
    await waitForOutput(firstOwner, "ACQUIRED");

    const contender = spawnOwner(paths.databasePath);
    await expect(waitForExit(contender)).resolves.toBe(2);

    firstOwner.kill();
    await waitForExit(firstOwner);

    reopenedOwner = spawnOwner(paths.databasePath);
    await waitForOutput(reopenedOwner, "ACQUIRED");
  } finally {
    if (firstOwner.exitCode === null) {
      firstOwner.kill();
      await waitForExit(firstOwner);
    }
    if (reopenedOwner?.exitCode === null) {
      reopenedOwner.kill();
      await waitForExit(reopenedOwner);
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}, 15_000);
