import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, SqliteDialect, type CompiledQuery } from "kysely";
import { expect, test } from "vitest";
import type { AppDatabaseSchema } from "../src/infrastructure/sqlite/app.database.ts";
import { acquireRootOwnership } from "../src/infrastructure/sqlite/root.ownership.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { SqliteBrowserRunRepository } from "../src/infrastructure/sqlite/sqlite.browser.run.repository.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";

test.each(["findActiveByProfileId", "listOccupying"] as const)(
  "%s uses the occupancy index for its actual repository query",
  async (method) => {
    const root = await fs.mkdtemp(join(tmpdir(), "antidetect-query-plan-"));
    const owner = acquireRootOwnership(join(root, "antidetect.sqlite"));
    const queries: CompiledQuery[] = [];
    const database = new Kysely<AppDatabaseSchema>({
      dialect: new SqliteDialect({ database: owner.sqlite }),
      log(event) {
        if (event.level === "query") queries.push(event.query);
      },
    });
    try {
      await runMigrations(database);
      const timestamp = "2026-09-19T10:00:00.000Z";
      const profileId = "profile-'quoted";
      await new SqliteProfileRepository(database).create({
        id: profileId,
        displayName: "Query plan profile",
        identityRef: "test-identity",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const runs = new SqliteBrowserRunRepository(database);
      const active = {
        id: "active-run",
        profileId,
        status: "recovery_required",
        processPid: null,
        processIdentity: null,
        failureCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        endedAt: null,
      } as const;
      await runs.create(active);
      await runs.create({
        ...active,
        id: "past-run",
        status: "stopped",
        endedAt: timestamp,
      });
      queries.length = 0;

      if (method === "findActiveByProfileId") {
        await expect(runs.findActiveByProfileId(profileId)).resolves.toEqual(active);
      } else {
        await expect(runs.listOccupying()).resolves.toEqual([active]);
      }

      expect(queries).toHaveLength(1);
      const query = queries[0]!;
      expect(query.parameters).toEqual(
        method === "findActiveByProfileId" ? [profileId] : [],
      );
      const plan = owner.sqlite
        .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
        .all(...query.parameters);
      expect(plan).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            detail: expect.stringContaining(
              "USING INDEX browser_runs_one_active_per_profile",
            ),
          }),
        ]),
      );
    } finally {
      await database.destroy();
      owner.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
