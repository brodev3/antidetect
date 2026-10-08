import { ShardX } from "@proxyshard/shardx";
import type { AppPaths } from "../../config/app.paths.js";

export function createShardXSdk(
  paths: Pick<AppPaths, "runtimeDir" | "profilesDir">,
): ShardX {
  return new ShardX({
    cacheDir: paths.runtimeDir,
    profilesDir: paths.profilesDir,
    autoInstall: false,
  });
}
