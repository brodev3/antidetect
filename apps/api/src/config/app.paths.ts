import { join, resolve } from "node:path";

export interface AppPaths {
  readonly rootDir: string;
  readonly configDir: string;
  readonly dataDir: string;
  readonly databasePath: string;
  readonly profilesDir: string;
  readonly runtimeDir: string;
  readonly logsDir: string;
}

export interface AppPathEnvironment {
  readonly ANTIDETECT_HOME?: string;
  readonly LOCALAPPDATA?: string;
}

export interface ResolveAppPathsOptions {
  readonly env?: AppPathEnvironment;
  readonly cwd?: string;
}

function requireNonEmptyPath(value: string, variableName: string): string {
  if (value.includes("\0")) {
    throw new Error(variableName + " must not contain a NUL character");
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(variableName + " must not be empty");
  }

  return trimmedValue;
}

function resolveRootDir(options: ResolveAppPathsOptions): string {
  const environment = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  if (environment.ANTIDETECT_HOME !== undefined) {
    return resolve(
      cwd,
      requireNonEmptyPath(environment.ANTIDETECT_HOME, "ANTIDETECT_HOME"),
    );
  }

  if (environment.LOCALAPPDATA === undefined) {
    throw new Error("ANTIDETECT_HOME or LOCALAPPDATA must be configured");
  }

  return resolve(
    requireNonEmptyPath(environment.LOCALAPPDATA, "LOCALAPPDATA"),
    "Antidetect",
  );
}

export function resolveAppPaths(options: ResolveAppPathsOptions = {}): AppPaths {
  const rootDir = resolveRootDir(options);

  return {
    rootDir,
    configDir: join(rootDir, "config"),
    dataDir: join(rootDir, "data"),
    databasePath: join(rootDir, "data", "antidetect.sqlite"),
    profilesDir: join(rootDir, "profiles"),
    runtimeDir: join(rootDir, "runtime"),
    logsDir: join(rootDir, "logs"),
  };
}
