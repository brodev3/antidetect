import { promises as fs } from "node:fs";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const apiEntryPoint = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const sqliteOwnerFixture = fileURLToPath(
  new URL("./fixtures/root-owner.mjs", import.meta.url),
);

interface ProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
}

async function createFreePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not determine a free TCP port");
  }

  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  return port;
}

function captureOutput(child: ChildProcess): ProcessOutput {
  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  return {
    get stdout(): string {
      return stdout;
    },
    get stderr(): string {
      return stderr;
    },
  };
}

function spawnApi(rootDir: string, port: number, host = "127.0.0.1"): ChildProcess {
  return spawn(process.execPath, [apiEntryPoint], {
    env: {
      ...process.env,
      ANTIDETECT_HOME: rootDir,
      API_HOST: host,
      API_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function spawnSqliteOwner(databasePath: string): ChildProcess {
  return spawn(process.execPath, [sqliteOwnerFixture, databasePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForOutput(
  child: ChildProcess,
  expected: string,
  timeoutMs = 10_000,
  capturedOutput?: ProcessOutput,
): Promise<void> {
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
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Child exited before output with code ${code}, signal ${signal}: ${output}`,
        ),
      );
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for child output (pid ${child.pid}, exit ${child.exitCode}, signal ${child.signalCode}): ${output} | captured stdout: ${capturedOutput?.stdout ?? ""} | captured stderr: ${capturedOutput?.stderr ?? ""}`,
        ),
      );
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
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

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined) {
    return;
  }

  const exit = waitForExit(child);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
  await exit;
}

async function expectHealth(port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
}

async function expectPortClosed(port: number): Promise<void> {
  await expect(
    fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(500),
    }),
  ).rejects.toThrow();
}

test("starts one API owner, rejects a concurrent owner, and allows restart", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-api-startup-"));
  const rootDir = join(tempRoot, "app");
  const firstPort = await createFreePort();
  const secondPort = await createFreePort();
  const thirdPort = await createFreePort();
  let firstOwner: ChildProcess | undefined;
  let contender: ChildProcess | undefined;
  let restartedOwner: ChildProcess | undefined;

  try {
    firstOwner = spawnApi(rootDir, firstPort);
    const firstOwnerOutput = captureOutput(firstOwner);
    await waitForOutput(
      firstOwner,
      `Antidetect API listening on http://127.0.0.1:${firstPort}`,
      10_000,
      firstOwnerOutput,
    );
    await expectHealth(firstPort);

    for (const directoryName of ["config", "profiles", "runtime", "logs"]) {
      await expect(fs.stat(join(rootDir, directoryName))).resolves.toBeDefined();
    }

    contender = spawnApi(rootDir, secondPort);
    const contenderOutput = captureOutput(contender);
    const contenderExitCode = await waitForExit(contender);

    expect(contenderExitCode).not.toBe(0);
    expect(contenderOutput.stderr).toContain("Application root is already in use");
    expect(contenderOutput.stdout).not.toContain("Antidetect API listening");
    await expectPortClosed(secondPort);
    await expectHealth(firstPort);

    await stopProcess(firstOwner);
    firstOwner = undefined;

    restartedOwner = spawnApi(rootDir, thirdPort);
    const restartedOwnerOutput = captureOutput(restartedOwner);
    await waitForOutput(
      restartedOwner,
      `Antidetect API listening on http://127.0.0.1:${thirdPort}`,
      10_000,
      restartedOwnerOutput,
    );
    await expectHealth(thirdPort);
  } finally {
    await stopProcess(contender);
    await stopProcess(restartedOwner);
    await stopProcess(firstOwner);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}, 30_000);

test("rejects startup before creating product directories", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-api-startup-blocked-"));
  const rootDir = join(tempRoot, "app");
  const dataDir = join(rootDir, "data");
  const databasePath = join(dataDir, "antidetect.sqlite");
  const port = await createFreePort();
  let sqliteOwner: ChildProcess | undefined;
  let apiProcess: ChildProcess | undefined;

  try {
    await fs.mkdir(dataDir, { recursive: true });
    sqliteOwner = spawnSqliteOwner(databasePath);
    await waitForOutput(sqliteOwner, "ACQUIRED");

    apiProcess = spawnApi(rootDir, port);
    const apiOutput = captureOutput(apiProcess);
    const apiExitCode = await waitForExit(apiProcess);

    expect(apiExitCode).not.toBe(0);
    expect(apiOutput.stderr).toContain("Application root is already in use");
    expect(apiOutput.stdout).not.toContain("Antidetect API listening");
    await expectPortClosed(port);

    for (const directoryName of ["config", "profiles", "runtime", "logs"]) {
      await expect(fs.stat(join(rootDir, directoryName))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  } finally {
    await stopProcess(apiProcess);
    await stopProcess(sqliteOwner);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}, 20_000);

test("rejects a non-loopback API_HOST before creating the root", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-api-host-"));
  const rootDir = join(tempRoot, "app");
  const port = await createFreePort();
  let apiProcess: ChildProcess | undefined;

  try {
    apiProcess = spawnApi(rootDir, port, "0.0.0.0");
    const apiOutput = captureOutput(apiProcess);
    const apiExitCode = await waitForExit(apiProcess);

    expect(apiExitCode).not.toBe(0);
    expect(apiOutput.stderr).toContain("API_HOST must be exactly 127.0.0.1 or ::1");
    expect(apiOutput.stdout).not.toContain("Antidetect API listening");
    await expectPortClosed(port);
    await expect(fs.stat(rootDir)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await stopProcess(apiProcess);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}, 20_000);
