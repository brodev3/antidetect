import { buildApp } from "./app.js";
import { formatApiHostForUrl, readApiServerConfig } from "./config/api.server.js";
import { resolveAppPaths } from "./config/app.paths.js";
import {
  ensureAppRootDirectories,
  ensurePostOwnershipDirectories,
} from "./infrastructure/filesystem/app.directories.js";
import { createApiRuntime } from "./infrastructure/lifecycle/api.runtime.js";
import {
  createAppDatabase,
  verifyAppDatabase,
} from "./infrastructure/sqlite/app.database.js";
import { runMigrations } from "./infrastructure/sqlite/migrations/migration.runner.js";
import { acquireRootOwnership } from "./infrastructure/sqlite/root.ownership.js";
import { SqliteProfileRepository } from "./infrastructure/sqlite/sqlite.profile.repository.js";
import { ShardXEngineStatusReader } from "./infrastructure/runtime/shardx.engine.status.reader.js";

const { host, port } = readApiServerConfig();

const appPaths = resolveAppPaths();
await ensureAppRootDirectories(appPaths);
const rootOwnership = acquireRootOwnership(appPaths.databasePath);
let runtime: ReturnType<typeof createApiRuntime> | undefined;

try {
  const appDatabase = createAppDatabase(rootOwnership);
  await verifyAppDatabase(appDatabase);
  await runMigrations(appDatabase);
  await ensurePostOwnershipDirectories(appPaths);
  const app = await buildApp({
    config: { host, port },
    profileRepository: new SqliteProfileRepository(appDatabase),
    engineStatusReader: new ShardXEngineStatusReader(appPaths.runtimeDir),
  });
  runtime = createApiRuntime(app, rootOwnership);

  await app.listen({ host, port });
  console.log(
    `Antidetect API listening on http://${formatApiHostForUrl(host)}:${port}`,
  );

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    try {
      await runtime?.close();
    } catch (error) {
      console.error(`API shutdown failed after ${signal}`, error);
      process.exitCode = 1;
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
} catch (error) {
  if (runtime === undefined) {
    rootOwnership.close();
  } else {
    await runtime.close();
  }

  throw error;
}
