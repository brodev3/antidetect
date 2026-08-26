import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveAppPaths } from "../src/config/app.paths.ts";

const fixtureRoot = join(tmpdir(), "antidetect-app-paths-fixture");

test("uses LOCALAPPDATA/Antidetect by default", () => {
  const localAppData = join(fixtureRoot, "LocalAppData");
  const paths = resolveAppPaths({
    env: { LOCALAPPDATA: localAppData },
    cwd: join(fixtureRoot, "workspace"),
  });

  expect(paths.rootDir).toBe(resolve(localAppData, "Antidetect"));
});

test("ANTIDETECT_HOME overrides LOCALAPPDATA", () => {
  const customRoot = join(fixtureRoot, "custom-root");
  const paths = resolveAppPaths({
    env: {
      ANTIDETECT_HOME: customRoot,
      LOCALAPPDATA: join(fixtureRoot, "LocalAppData"),
    },
    cwd: join(fixtureRoot, "workspace"),
  });

  expect(paths.rootDir).toBe(resolve(customRoot));
});

test("resolves a relative ANTIDETECT_HOME from cwd", () => {
  const cwd = join(fixtureRoot, "workspace");
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: "./data" },
    cwd,
  });

  expect(paths.rootDir).toBe(resolve(cwd, "data"));
});

test("returns all paths under the selected root without touching the filesystem", () => {
  const rootDir = join(fixtureRoot, "not-created");
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: rootDir },
  });

  expect(paths).toEqual({
    rootDir: resolve(rootDir),
    configDir: join(resolve(rootDir), "config"),
    dataDir: join(resolve(rootDir), "data"),
    databasePath: join(resolve(rootDir), "data", "antidetect.sqlite"),
    profilesDir: join(resolve(rootDir), "profiles"),
    runtimeDir: join(resolve(rootDir), "runtime"),
    logsDir: join(resolve(rootDir), "logs"),
  });
  expect(existsSync(paths.rootDir)).toBe(false);
});

test("rejects missing environment configuration", () => {
  expect(() =>
    resolveAppPaths({
      env: {},
      cwd: join(fixtureRoot, "workspace"),
    }),
  ).toThrow("ANTIDETECT_HOME or LOCALAPPDATA must be configured");
});

test.each(["", "   "])("rejects an empty ANTIDETECT_HOME value", (home) => {
  expect(() =>
    resolveAppPaths({
      env: { ANTIDETECT_HOME: home },
      cwd: join(fixtureRoot, "workspace"),
    }),
  ).toThrow("ANTIDETECT_HOME must not be empty");
});

test("rejects an ANTIDETECT_HOME value with a NUL character", () => {
  const invalidHome = "invalid" + String.fromCharCode(0) + "path";

  expect(() =>
    resolveAppPaths({
      env: { ANTIDETECT_HOME: invalidHome },
      cwd: join(fixtureRoot, "workspace"),
    }),
  ).toThrow("ANTIDETECT_HOME must not contain a NUL character");
});
