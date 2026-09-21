import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  apiErrorSchema,
  listProfilesResponseSchema,
  profileResponseSchema,
} from "@antidetect/contracts";
import { expect, test } from "vitest";
import { buildApp } from "../src/app.ts";
import { resolveAppPaths, type AppPaths } from "../src/config/app.paths.ts";
import { ensureAppRootDirectories } from "../src/infrastructure/filesystem/app.directories.ts";
import { createAppDatabase } from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";
import {
  acquireRootOwnership,
  type RootOwnership,
} from "../src/infrastructure/sqlite/root.ownership.ts";

const requestHeaders = { host: "127.0.0.1:3000" };

interface ProfileAppFixture {
  readonly app: NestFastifyApplication;
  readonly repository: SqliteProfileRepository;
  readonly rootOwnership: RootOwnership;
}

interface OpenApiParameter {
  readonly name: string;
  readonly schema?: {
    readonly default?: number;
    readonly maximum?: number;
    readonly minimum?: number;
  };
}

interface OpenApiOperation {
  readonly parameters?: readonly OpenApiParameter[];
  readonly responses: Readonly<Record<string, unknown>>;
}

interface OpenApiPath {
  readonly get?: OpenApiOperation;
  readonly post?: OpenApiOperation;
}

interface OpenApiDocument {
  readonly paths: Readonly<Record<string, OpenApiPath>>;
}

async function openProfileApp(paths: AppPaths): Promise<ProfileAppFixture> {
  const rootOwnership = acquireRootOwnership(paths.databasePath);

  try {
    const database = createAppDatabase(rootOwnership);
    await runMigrations(database);
    const repository = new SqliteProfileRepository(database);
    const app = await buildApp({ profileRepository: repository });

    return { app, repository, rootOwnership };
  } catch (error) {
    rootOwnership.close();
    throw error;
  }
}

async function closeProfileApp(fixture: ProfileAppFixture): Promise<void> {
  try {
    await fixture.app.close();
  } finally {
    fixture.rootOwnership.close();
  }
}

async function createTestPaths(prefix: string): Promise<{
  readonly paths: AppPaths;
  readonly tempRoot: string;
}> {
  const tempRoot = await fs.mkdtemp(join(tmpdir(), prefix));
  const paths = resolveAppPaths({
    env: { ANTIDETECT_HOME: join(tempRoot, "app") },
  });
  await ensureAppRootDirectories(paths);
  return { paths, tempRoot };
}

test("creates a profile and reads it after reopening the database", async () => {
  const { paths, tempRoot } = await createTestPaths("antidetect-profile-api-");
  const firstFixture = await openProfileApp(paths);
  let createdProfile: ReturnType<typeof profileResponseSchema.parse>;

  try {
    const createResponse = await firstFixture.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/profiles",
        headers: requestHeaders,
        payload: { displayName: "  Research profile  " },
      });

    expect(createResponse.statusCode).toBe(201);
    createdProfile = profileResponseSchema.parse(createResponse.json());
    expect(createdProfile).toMatchObject({
      displayName: "Research profile",
      identityRef: `test-identity:${createdProfile.id}`,
    });
  } finally {
    await closeProfileApp(firstFixture);
  }

  const secondFixture = await openProfileApp(paths);

  try {
    const getResponse = await secondFixture.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/profiles/${createdProfile.id}`,
        headers: requestHeaders,
      });

    expect(getResponse.statusCode).toBe(200);
    expect(profileResponseSchema.parse(getResponse.json())).toEqual(createdProfile);
  } finally {
    await closeProfileApp(secondFixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("returns a bounded and stably ordered profile list", async () => {
  const { paths, tempRoot } = await createTestPaths("antidetect-profile-list-api-");
  const fixture = await openProfileApp(paths);
  const firstTimestamp = "2026-09-21T01:00:00.000Z";
  const profiles = [
    {
      id: "00000000-0000-4000-8000-000000000003",
      displayName: "Third",
      identityRef: "test-identity:00000000-0000-4000-8000-000000000003",
      createdAt: "2026-09-21T02:00:00.000Z",
      updatedAt: "2026-09-21T02:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      displayName: "Second",
      identityRef: "test-identity:00000000-0000-4000-8000-000000000002",
      createdAt: firstTimestamp,
      updatedAt: firstTimestamp,
    },
    {
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "First",
      identityRef: "test-identity:00000000-0000-4000-8000-000000000001",
      createdAt: firstTimestamp,
      updatedAt: firstTimestamp,
    },
  ] as const;

  try {
    for (const profile of profiles) {
      await fixture.repository.create(profile);
    }

    const firstPageResponse = await fixture.app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/profiles?limit=2&offset=0",
      headers: requestHeaders,
    });
    const firstPage = listProfilesResponseSchema.parse(firstPageResponse.json());

    expect(firstPageResponse.statusCode).toBe(200);
    expect(firstPage.items.map(({ id }) => id)).toEqual([
      profiles[2].id,
      profiles[1].id,
    ]);
    expect(firstPage.nextOffset).toBe(2);

    const secondPageResponse = await fixture.app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/profiles?limit=2&offset=2",
      headers: requestHeaders,
    });
    const secondPage = listProfilesResponseSchema.parse(secondPageResponse.json());

    expect(secondPageResponse.statusCode).toBe(200);
    expect(secondPage.items.map(({ id }) => id)).toEqual([profiles[0].id]);
    expect(secondPage.nextOffset).toBeNull();
  } finally {
    await closeProfileApp(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("maps validation and not-found failures to stable public errors", async () => {
  const { paths, tempRoot } = await createTestPaths("antidetect-profile-errors-api-");
  const fixture = await openProfileApp(paths);

  try {
    const invalidResponses = await Promise.all([
      fixture.app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: "/profiles",
          headers: requestHeaders,
          payload: { displayName: "   " },
        }),
      fixture.app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/profiles/not-a-uuid",
        headers: requestHeaders,
      }),
      fixture.app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/profiles?limit=101",
        headers: requestHeaders,
      }),
    ]);

    for (const response of invalidResponses) {
      expect(response.statusCode).toBe(400);
      expect(apiErrorSchema.parse(response.json())).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
        },
      });
    }

    const notFoundResponse = await fixture.app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/profiles/00000000-0000-4000-8000-000000000099",
      headers: requestHeaders,
    });

    expect(notFoundResponse.statusCode).toBe(404);
    expect(apiErrorSchema.parse(notFoundResponse.json())).toEqual({
      error: {
        code: "PROFILE_NOT_FOUND",
        message: "Profile was not found",
      },
    });

    const forbiddenResponse = await fixture.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/profiles",
        headers: {
          ...requestHeaders,
          origin: "https://malicious.example",
        },
        payload: { displayName: "Blocked" },
      });

    expect(forbiddenResponse.statusCode).toBe(403);
    await expect(fixture.repository.list({ limit: 1, offset: 0 })).resolves.toEqual([]);
  } finally {
    await closeProfileApp(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("documents profile routes and explicit pagination limits", async () => {
  const { paths, tempRoot } = await createTestPaths("antidetect-profile-openapi-");
  const fixture = await openProfileApp(paths);

  try {
    const response = await fixture.app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/docs-json",
      headers: requestHeaders,
    });
    const document = response.json() as OpenApiDocument;
    const profilesPath = document.paths["/profiles"];
    const profilePath = document.paths["/profiles/{profileId}"];
    const limitParameter = profilesPath?.get?.parameters?.find(
      ({ name }) => name === "limit",
    );
    const offsetParameter = profilesPath?.get?.parameters?.find(
      ({ name }) => name === "offset",
    );

    expect(response.statusCode).toBe(200);
    expect(profilesPath?.post?.responses["201"]).toBeDefined();
    expect(profilesPath?.post?.responses["400"]).toBeDefined();
    expect(profilesPath?.get?.responses["200"]).toBeDefined();
    expect(profilesPath?.get?.responses["400"]).toBeDefined();
    expect(profilePath?.get?.responses["200"]).toBeDefined();
    expect(profilePath?.get?.responses["400"]).toBeDefined();
    expect(profilePath?.get?.responses["404"]).toBeDefined();
    expect(limitParameter?.schema).toMatchObject({
      default: 50,
      maximum: 100,
      minimum: 1,
    });
    expect(offsetParameter?.schema).toMatchObject({
      default: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      minimum: 0,
    });
  } finally {
    await closeProfileApp(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
