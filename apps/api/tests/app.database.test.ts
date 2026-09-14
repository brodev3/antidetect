import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { expect, test } from "vitest";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { ensureAppRootDirectories } from "../src/infrastructure/filesystem/app.directories.ts";
import {
  createAppDatabase,
  verifyAppDatabase,
} from "../src/infrastructure/sqlite/app.database.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";

test("creates Kysely over the root ownership SQLite connection", async () => {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), "antidetect-app-database-"));
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);

  const rootOwnership = acquireRootOwnership(paths.databasePath);
  const database = createAppDatabase(rootOwnership);

  try {
    await expect(verifyAppDatabase(database)).resolves.toBeUndefined();

    rootOwnership.close();

    await expect(sql`select 1`.execute(database)).rejects.toThrow();
  } finally {
    rootOwnership.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
