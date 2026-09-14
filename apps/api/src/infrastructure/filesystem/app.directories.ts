import { mkdir } from "node:fs/promises";
import type { AppPaths } from "../../config/app.paths.js";

const rootDirectoryNames: ReadonlyArray<keyof AppPaths> = ["rootDir", "dataDir"];

const postOwnershipDirectoryNames: ReadonlyArray<keyof AppPaths> = [
  "configDir",
  "profilesDir",
  "runtimeDir",
  "logsDir",
];

async function ensureDirectories(
  paths: AppPaths,
  directoryNames: ReadonlyArray<keyof AppPaths>,
): Promise<void> {
  for (const directoryName of directoryNames) {
    await mkdir(paths[directoryName], { recursive: true });
  }
}

export function ensureAppRootDirectories(paths: AppPaths): Promise<void> {
  return ensureDirectories(paths, rootDirectoryNames);
}

export function ensurePostOwnershipDirectories(paths: AppPaths): Promise<void> {
  return ensureDirectories(paths, postOwnershipDirectoryNames);
}

export async function ensureAppDirectories(paths: AppPaths): Promise<void> {
  await ensureAppRootDirectories(paths);
  await ensurePostOwnershipDirectories(paths);
}
