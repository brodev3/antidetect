import { mkdir } from "node:fs/promises";
import type { AppPaths } from "../../config/app.paths.js";

const directoryNames: ReadonlyArray<keyof AppPaths> = [
  "configDir",
  "dataDir",
  "profilesDir",
  "runtimeDir",
  "logsDir",
];

export async function ensureAppDirectories(paths: AppPaths): Promise<void> {
  for (const directoryName of directoryNames) {
    await mkdir(paths[directoryName], { recursive: true });
  }
}
