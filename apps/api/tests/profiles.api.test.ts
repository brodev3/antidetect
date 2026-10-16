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
import {
  FingerprintGenerationError,
  type FingerprintGenerator,
} from "../src/application/fingerprints/fingerprint.generator.ts";
import { resolveAppPaths, type AppPaths } from "../src/config/app.paths.ts";
import { ensureAppRootDirectories } from "../src/infrastructure/filesystem/app.directories.ts";
import { createAppDatabase } from "../src/infrastructure/sqlite/app.database.ts";
import { runMigrations } from "../src/infrastructure/sqlite/migrations/migration.runner.ts";
import { SqliteFingerprintIdentityRepository } from "../src/infrastructure/sqlite/sqlite.fingerprint.identity.repository.ts";
import { SqliteProfileRepository } from "../src/infrastructure/sqlite/sqlite.profile.repository.ts";
import {
  acquireRootOwnership,
  type RootOwnership,
} from "../src/infrastructure/sqlite/root.ownership.ts";

const requestHeaders = {
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
};
const testFingerprintConfig = {
  navigator: { platform: "Windows", languages: ["en-US"] },
};
const testFingerprintGenerator: FingerprintGenerator = {
  async generate() {
    return testFingerprintConfig;
  },
};

interface ProfileAppFixture {
  readonly app: NestFastifyApplication;
  readonly repository: SqliteProfileRepository;
  readonly identities: SqliteFingerprintIdentityRepository;
  readonly rootOwnership: RootOwnership;
  readonly requestHeaders: Record<string, string>;
}

interface OpenApiParameter {
  readonly name: string;
  readonly default?: number | string;
  readonly schema?: {
    readonly default?: number | string;
    readonly enum?: readonly string[];
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

async function openProfileApp(
  paths: AppPaths,
  fingerprintGenerator: FingerprintGenerator = testFingerprintGenerator,
): Promise<ProfileAppFixture> {
  const rootOwnership = acquireRootOwnership(paths.databasePath);

  try {
    const database = createAppDatabase(rootOwnership);
    await runMigrations(database);
    const repository = new SqliteProfileRepository(database);
    const identities = new SqliteFingerprintIdentityRepository(database);
    const app = await buildApp({ profileRepository: repository, fingerprintGenerator });
    const sessionResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/session",
      headers: requestHeaders,
    });
    const setCookie = String(sessionResponse.headers["set-cookie"] ?? "");
    const sessionCookie = setCookie.split(";", 1)[0];

    if (
      sessionResponse.statusCode !== 204 ||
      sessionCookie === undefined ||
      sessionCookie === ""
    ) {
      throw new Error("Unable to establish API test session");
    }

    return {
      app,
      repository,
      identities,
      rootOwnership,
      requestHeaders: { ...requestHeaders, cookie: sessionCookie },
    };
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
        headers: firstFixture.requestHeaders,
        payload: { displayName: "  Research profile  " },
      });

    expect(createResponse.statusCode, createResponse.body).toBe(201);
    createdProfile = profileResponseSchema.parse(createResponse.json());
    expect(createdProfile).toMatchObject({
      profileCode: "profile-001",
      displayName: "Research profile",
      fingerprintPlatform: "Windows",
      fingerprintEnabled: true,
    });
    expect(createdProfile.identityRef).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
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
        headers: secondFixture.requestHeaders,
      });

    expect(getResponse.statusCode).toBe(200);
    expect(profileResponseSchema.parse(getResponse.json())).toEqual(createdProfile);
    await expect(
      secondFixture.identities.findById(createdProfile.identityRef!),
    ).resolves.toMatchObject({
      id: createdProfile.identityRef,
      config: testFingerprintConfig,
    });
  } finally {
    await closeProfileApp(secondFixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("creates and persists a profile without a fingerprint", async () => {
  const { paths, tempRoot } = await createTestPaths(
    "antidetect-profile-no-fingerprint-api-",
  );
  let generationCalls = 0;
  const fingerprintGenerator: FingerprintGenerator = {
    async generate() {
      generationCalls += 1;
      throw new FingerprintGenerationError("RUNTIME_NOT_INSTALLED");
    },
  };
  const firstFixture = await openProfileApp(paths, fingerprintGenerator);
  let createdProfile: ReturnType<typeof profileResponseSchema.parse>;

  try {
    const response = await firstFixture.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/profiles",
        headers: firstFixture.requestHeaders,
        payload: {
          displayName: "Direct profile",
          fingerprintEnabled: false,
          fingerprintPlatform: "macOS",
        },
      });

    expect(response.statusCode, response.body).toBe(201);
    createdProfile = profileResponseSchema.parse(response.json());
    expect(createdProfile).toMatchObject({
      fingerprintEnabled: false,
      fingerprintPlatform: "macOS",
      identityRef: null,
    });
    expect(generationCalls).toBe(0);
  } finally {
    await closeProfileApp(firstFixture);
  }

  const secondFixture = await openProfileApp(paths);

  try {
    const response = await secondFixture.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/profiles/${createdProfile.id}`,
        headers: secondFixture.requestHeaders,
      });

    expect(profileResponseSchema.parse(response.json())).toEqual(createdProfile);
  } finally {
    await closeProfileApp(secondFixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test.each([
  {
    generationCode: "RUNTIME_NOT_INSTALLED",
    statusCode: 503,
    apiCode: "FINGERPRINT_RUNTIME_NOT_READY",
  },
  {
    generationCode: "FINGERPRINT_GENERATION_FAILED",
    statusCode: 500,
    apiCode: "FINGERPRINT_GENERATION_FAILED",
  },
] as const)(
  "maps $generationCode to a safe API error without persisting a profile",
  async ({ generationCode, statusCode, apiCode }) => {
    const { paths, tempRoot } = await createTestPaths(
      "antidetect-profile-generation-api-",
    );
    const fingerprintGenerator: FingerprintGenerator = {
      async generate() {
        throw new FingerprintGenerationError(generationCode);
      },
    };
    const fixture = await openProfileApp(paths, fingerprintGenerator);

    try {
      const response = await fixture.app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: "/profiles",
          headers: fixture.requestHeaders,
          payload: { displayName: "Runtime unavailable" },
        });

      expect(response.statusCode).toBe(statusCode);
      expect(apiErrorSchema.parse(response.json())).toEqual({
        error: {
          code: apiCode,
          message:
            generationCode === "RUNTIME_NOT_INSTALLED"
              ? "Fingerprint runtime is not installed or is incomplete"
              : "Fingerprint generation failed",
        },
      });
      await expect(
        fixture.repository.list({
          limit: 10,
          offset: 0,
          sortBy: "createdAt",
          sortOrder: "asc",
        }),
      ).resolves.toEqual([]);
    } finally {
      await closeProfileApp(fixture);
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  },
);

test("returns a bounded and stably ordered profile list", async () => {
  const { paths, tempRoot } = await createTestPaths("antidetect-profile-list-api-");
  const fixture = await openProfileApp(paths);
  const firstTimestamp = "2026-09-21T01:00:00.000Z";
  const profiles = [
    {
      id: "00000000-0000-4000-8000-000000000003",
      displayName: "Third",
      fingerprintPlatform: "Windows",
      fingerprintEnabled: true,
      identityRef: "test-identity:00000000-0000-4000-8000-000000000003",
      createdAt: "2026-09-21T02:00:00.000Z",
      updatedAt: "2026-09-21T02:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      displayName: "Second",
      fingerprintPlatform: "Windows",
      fingerprintEnabled: true,
      identityRef: "test-identity:00000000-0000-4000-8000-000000000002",
      createdAt: firstTimestamp,
      updatedAt: firstTimestamp,
    },
    {
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "First",
      fingerprintPlatform: "Windows",
      fingerprintEnabled: true,
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
      headers: fixture.requestHeaders,
    });
    expect(firstPageResponse.statusCode, firstPageResponse.body).toBe(200);
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
      headers: fixture.requestHeaders,
    });
    const secondPage = listProfilesResponseSchema.parse(secondPageResponse.json());

    expect(secondPageResponse.statusCode).toBe(200);
    expect(secondPage.items.map(({ id }) => id)).toEqual([profiles[0].id]);
    expect(secondPage.nextOffset).toBeNull();

    const searchedResponse = await fixture.app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/profiles?search=ir&sortBy=displayName&sortOrder=desc&limit=10",
      headers: fixture.requestHeaders,
    });
    expect(searchedResponse.statusCode, searchedResponse.body).toBe(200);
    const searchedProfiles = listProfilesResponseSchema.parse(searchedResponse.json());
    expect(searchedProfiles.items.map(({ displayName }) => displayName)).toEqual([
      "Third",
      "First",
    ]);
    expect(searchedProfiles.nextOffset).toBeNull();
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
          headers: fixture.requestHeaders,
          payload: { displayName: "   " },
        }),
      fixture.app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/profiles/not-a-uuid",
        headers: fixture.requestHeaders,
      }),
      fixture.app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/profiles?limit=101",
        headers: fixture.requestHeaders,
      }),
      fixture.app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/profiles?sortBy=id",
        headers: fixture.requestHeaders,
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
      headers: fixture.requestHeaders,
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
          ...fixture.requestHeaders,
          origin: "https://malicious.example",
        },
        payload: { displayName: "Blocked" },
      });

    expect(forbiddenResponse.statusCode).toBe(403);
    await expect(
      fixture.repository.list({
        limit: 1,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "asc",
      }),
    ).resolves.toEqual([]);
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
    const searchParameter = profilesPath?.get?.parameters?.find(
      ({ name }) => name === "search",
    );
    const sortByParameter = profilesPath?.get?.parameters?.find(
      ({ name }) => name === "sortBy",
    );
    const sortOrderParameter = profilesPath?.get?.parameters?.find(
      ({ name }) => name === "sortOrder",
    );

    expect(response.statusCode).toBe(200);
    expect(profilesPath?.post?.responses["201"]).toBeDefined();
    expect(profilesPath?.post?.responses["400"]).toBeDefined();
    expect(profilesPath?.post?.responses["500"]).toBeDefined();
    expect(profilesPath?.post?.responses["503"]).toBeDefined();
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
    expect(searchParameter?.schema).toMatchObject({ maxLength: 100 });
    expect(sortByParameter?.schema).toMatchObject({
      default: "createdAt",
      enum: ["createdAt", "displayName"],
    });
    expect(sortOrderParameter?.schema).toMatchObject({
      default: "asc",
      enum: ["asc", "desc"],
    });
  } finally {
    await closeProfileApp(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
