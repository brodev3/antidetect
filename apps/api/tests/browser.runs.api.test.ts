import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  apiErrorSchema,
  browserRunStateResponseSchema,
  profileResponseSchema,
} from "@antidetect/contracts";
import { expect, test, vi } from "vitest";
import { buildTestApp } from "./support/build.test.app.ts";
import type {
  BrowserRun,
  BrowserRunRepository,
} from "../src/application/browserRuns/browser.run.repository.ts";
import { BrowserLifecycleService } from "../src/application/browserRuns/browser.lifecycle.service.ts";
import {
  FingerprintGenerationError,
  type FingerprintGenerator,
} from "../src/application/fingerprints/fingerprint.generator.ts";
import type { FingerprintIdentity } from "../src/application/fingerprints/fingerprint.identity.repository.ts";
import type {
  BrowserRuntime,
  RuntimeLaunchInput,
  RuntimeLaunchResult,
  RuntimeProcess,
  RuntimeRecoveryInput,
  RuntimeRecoveryResult,
  RuntimeStopOptions,
  RuntimeStopResult,
} from "../src/application/runtime/browser.runtime.ts";
import type {
  Profile,
  ProfileFingerprintCreationRepository,
  ProfileFingerprintSettings,
  ProfileRepository,
} from "../src/application/profiles/profile.repository.ts";
import {
  FakeBrowserProcessHost,
  FakeBrowserRuntime,
} from "../src/infrastructure/runtime/fake.browser.runtime.ts";

const profileId = "00000000-0000-4000-8000-000000000001";
const secondProfileId = "00000000-0000-4000-8000-000000000002";
const recoveryRunId = "00000000-0000-4000-8000-000000000020";
const requestHeaders = {
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
};
const secondProfile: Profile = {
  id: secondProfileId,
  profileCode: "profile-002",
  displayName: "Other profile",
  fingerprintPlatform: "Windows",
  fingerprintEnabled: true,
  identityRef: "test-identity:other",
  createdAt: "2026-09-23T01:00:00.000Z",
  updatedAt: "2026-09-23T01:00:00.000Z",
};

function createRepositories(additionalProfiles: readonly Profile[] = []): {
  readonly profiles: ProfileRepository & ProfileFingerprintCreationRepository;
  readonly runs: BrowserRunRepository;
  readonly identities: Map<string, FingerprintIdentity>;
} {
  const profile: Profile = {
    id: profileId,
    profileCode: "profile-001",
    displayName: "Runtime profile",
    fingerprintPlatform: "Windows",
    fingerprintEnabled: true,
    identityRef: "test-identity:runtime",
    createdAt: "2026-09-23T01:00:00.000Z",
    updatedAt: "2026-09-23T01:00:00.000Z",
  };
  const profileRows = new Map<string, Profile>([[profile.id, profile]]);
  for (const additionalProfile of additionalProfiles) {
    profileRows.set(additionalProfile.id, additionalProfile);
  }
  const runRows = new Map<string, BrowserRun>();
  const identityRows = new Map<string, FingerprintIdentity>();

  const profiles: ProfileRepository & ProfileFingerprintCreationRepository = {
    async create(value) {
      const created = {
        ...value,
        fingerprintPlatform: value.fingerprintPlatform ?? "Windows",
        profileCode: "profile-001",
      };
      profileRows.set(created.id, created);
      return created;
    },
    async createWithFingerprint(value, identity) {
      const created = {
        ...value,
        fingerprintPlatform: value.fingerprintPlatform ?? "Windows",
        profileCode: "profile-001",
        fingerprintEnabled: true,
        identityRef: identity.id,
      };
      profileRows.set(created.id, created);
      return created;
    },
    async findById(id) {
      return profileRows.get(id) ?? null;
    },
    async updateFingerprintSettings(id, settings: ProfileFingerprintSettings) {
      const current = profileRows.get(id);
      if (current === undefined) return null;
      const updated = { ...current, ...settings };
      profileRows.set(id, updated);
      return updated;
    },
    async enableFingerprintWithIdentity(id, identity, updatedAt) {
      const current = profileRows.get(id);
      if (current === undefined) return null;
      const updated: Profile = {
        ...current,
        fingerprintEnabled: true,
        identityRef: identity.id,
        updatedAt,
      };
      identityRows.set(identity.id, structuredClone(identity));
      profileRows.set(id, updated);
      return updated;
    },
    async replaceFingerprintIdentity(id, identity, updatedAt, fingerprintPlatform) {
      const current = profileRows.get(id);
      if (current === undefined) return null;
      const updated: Profile = {
        ...current,
        ...(fingerprintPlatform === undefined ? {} : { fingerprintPlatform }),
        identityRef: identity.id,
        updatedAt,
      };
      identityRows.set(identity.id, structuredClone(identity));
      profileRows.set(id, updated);
      return updated;
    },
    async list() {
      return [...profileRows.values()];
    },
  };

  const runs: BrowserRunRepository = {
    async create(run) {
      runRows.set(run.id, run);
      return run;
    },
    async findById(id) {
      return runRows.get(id) ?? null;
    },
    async findActiveByProfileId(id) {
      return (
        [...runRows.values()].find(
          (run) =>
            run.profileId === id &&
            ["starting", "running", "stopping", "recovery_required"].includes(
              run.status,
            ),
        ) ?? null
      );
    },
    async findLatestByProfileId(id) {
      return [...runRows.values()].filter((run) => run.profileId === id).at(-1) ?? null;
    },
    async listOccupying() {
      return [...runRows.values()].filter((run) =>
        ["starting", "running", "stopping", "recovery_required"].includes(run.status),
      );
    },
    async save(run) {
      runRows.set(run.id, run);
      return run;
    },
  };

  return { profiles, runs, identities: identityRows };
}

function createRecoveryRun(processPid: number, processIdentity: string): BrowserRun {
  return {
    id: recoveryRunId,
    profileId,
    status: "recovery_required",
    processPid,
    processIdentity,
    failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
    createdAt: "2026-09-23T01:00:00.000Z",
    updatedAt: "2026-09-23T01:01:00.000Z",
    endedAt: null,
  };
}

async function openRuntimeApp(
  runtime: BrowserRuntime = new FakeBrowserRuntime({ firstPid: 4500 }),
  repositories = createRepositories(),
  fingerprintGenerator: FingerprintGenerator = {
    async generate() {
      return { navigator: { platform: "Windows", languages: ["en-US"] } };
    },
  },
): Promise<{
  readonly app: NestFastifyApplication;
  readonly lifecycle: BrowserLifecycleService;
}> {
  const { profiles, runs } = repositories;
  const lifecycle = new BrowserLifecycleService(profiles, runs, runtime, undefined, {
    profileDirectoryFor: (id) => `C:/profiles/${id}`,
    createRunId: () => "00000000-0000-4000-8000-000000000010",
    fingerprintGenerator,
  });

  const app = await buildTestApp({
    profileRepository: profiles,
    browserLifecycleService: lifecycle,
  });
  return { app, lifecycle };
}

async function establishSession(
  app: NestFastifyApplication,
): Promise<Record<string, string>> {
  const response = await app.getHttpAdapter().getInstance().inject({
    method: "GET",
    url: "/session",
    headers: requestHeaders,
  });
  const setCookie = String(response.headers["set-cookie"] ?? "");
  const sessionCookie = setCookie.split(";", 1)[0] ?? "";

  expect(response.statusCode).toBe(204);
  expect(sessionCookie).not.toBe("");
  return { ...requestHeaders, cookie: sessionCookie };
}

test.each([
  { method: "emitNormalExit", status: "stopped" },
  { method: "emitUnexpectedExit", status: "failed" },
  { method: "emitUnknownExit", status: "failed" },
] as const)(
  "reads $status after $method without exposing exit diagnostics",
  async ({ method, status }) => {
    const runtime = new FakeBrowserRuntime();
    const { app, lifecycle } = await openRuntimeApp(runtime);
    const headers = await establishSession(app);
    try {
      const startResponse = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: `/profiles/${profileId}/start`,
          headers,
        });
      expect(startResponse.statusCode).toBe(202);
      await vi.waitFor(async () => {
        expect((await lifecycle.getLatest(profileId))?.status).toBe("running");
        expect(runtime.activeProcesses()).toHaveLength(1);
      });
      const process = runtime.activeProcesses()[0];
      expect(process).toBeDefined();
      runtime[method](process!, { code: 0, signal: "EXIT_SIGNAL_SENTINEL" });

      await vi.waitFor(async () => {
        const response = await app
          .getHttpAdapter()
          .getInstance()
          .inject({
            method: "GET",
            url: `/profiles/${profileId}/run`,
            headers,
          });
        expect(response.statusCode).toBe(200);
        const body = browserRunStateResponseSchema.parse(response.json());
        expect(body.run?.status).toBe(status);
        expect(Object.keys(body.run ?? {}).sort()).toEqual([
          "createdAt",
          "endedAt",
          "id",
          "profileId",
          "status",
          "updatedAt",
        ]);
        expect(response.body).not.toContain("EXIT_SIGNAL_SENTINEL");
      });
    } finally {
      await app.close();
    }
  },
);

test("starts, reads, stops, and repeats stop through the lifecycle API", async () => {
  const { app } = await openRuntimeApp();
  const headers = await establishSession(app);

  try {
    const openApiResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/docs-json",
      headers: requestHeaders,
    });
    const openApiDocument = openApiResponse.json() as {
      paths: Record<string, { post?: { responses: Record<string, unknown> } }>;
    };
    expect(
      openApiDocument.paths["/profiles/{profileId}/start"]?.post?.responses,
    ).toHaveProperty("202");
    expect(
      openApiDocument.paths["/profiles/{profileId}/stop"]?.post?.responses,
    ).toHaveProperty("200");
    expect(
      openApiDocument.paths["/profiles/{profileId}/stop"]?.post?.responses,
    ).toHaveProperty("202");

    const invalidProfileResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/profiles/not-a-uuid/start",
      headers,
    });
    expect(invalidProfileResponse.statusCode).toBe(400);
    expect(apiErrorSchema.parse(invalidProfileResponse.json())).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
      },
    });

    const missingProfileResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/profiles/00000000-0000-4000-8000-000000000099/start",
      headers,
    });
    expect(missingProfileResponse.statusCode).toBe(404);
    expect(apiErrorSchema.parse(missingProfileResponse.json())).toEqual({
      error: {
        code: "PROFILE_NOT_FOUND",
        message: "Profile was not found",
      },
    });

    const startResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/start`,
        headers,
      });
    const started = browserRunStateResponseSchema.parse(startResponse.json());

    expect(startResponse.statusCode).toBe(202);
    expect(startResponse.headers.location).toBe(`/profiles/${profileId}/run`);
    expect(started.run).toMatchObject({ profileId, status: "starting", endedAt: null });
    expect(startResponse.json()).not.toHaveProperty("processPid");

    await vi.waitFor(async () => {
      const activeResponse = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "GET",
          url: `/profiles/${profileId}/run`,
          headers,
        });
      expect(activeResponse.statusCode).toBe(200);
      expect(
        browserRunStateResponseSchema.parse(activeResponse.json()).run,
      ).toMatchObject({
        id: started.run?.id,
        status: "running",
      });
    });

    const conflictResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/start`,
        headers,
      });
    expect(conflictResponse.statusCode).toBe(409);
    expect(apiErrorSchema.parse(conflictResponse.json())).toEqual({
      error: {
        code: "ACTIVE_BROWSER_RUN_CONFLICT",
        message: "Profile already has an active browser run",
      },
    });

    const stopResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/stop`,
        headers,
      });
    const stopped = browserRunStateResponseSchema.parse(stopResponse.json());
    expect(stopResponse.statusCode).toBe(202);
    expect(stopResponse.headers.location).toBe(`/profiles/${profileId}/run`);
    expect(stopped.run).toMatchObject({ profileId, status: "stopping" });

    await vi.waitFor(async () => {
      const latestResponse = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "GET",
          url: `/profiles/${profileId}/run`,
          headers,
        });
      expect(latestResponse.statusCode).toBe(200);
      expect(
        browserRunStateResponseSchema.parse(latestResponse.json()).run,
      ).toMatchObject({
        id: started.run?.id,
        status: "stopped",
      });
    });

    const repeatedStopResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/stop`,
        headers,
      });
    expect(repeatedStopResponse.statusCode).toBe(200);
    expect(
      browserRunStateResponseSchema.parse(repeatedStopResponse.json()).run,
    ).toMatchObject({
      id: started.run?.id,
      status: "stopped",
    });
  } finally {
    await app.close();
  }
});

test("verified recovery is visible through the API and only occupies its profile", async () => {
  const processHost = new FakeBrowserProcessHost();
  const previousRuntime = new FakeBrowserRuntime({ processHost, firstPid: 4500 });
  const launched = await previousRuntime.launch({
    runId: recoveryRunId,
    profileId,
    profileDirectory: `C:/profiles/${profileId}`,
    identityRef: "test-identity:runtime",
  });
  if (launched.status !== "started") {
    throw new Error("Expected the existing fake process to start");
  }
  processHost.simulateApiProcessExit();

  const repositories = createRepositories([secondProfile]);
  await repositories.runs.create(
    createRecoveryRun(launched.process.pid ?? 0, launched.process.processIdentity),
  );
  const runtime = new FakeBrowserRuntime({ processHost, firstPid: 4600 });
  const { app, lifecycle } = await openRuntimeApp(runtime, repositories);
  await lifecycle.recoverPersistedRuns();
  const headers = await establishSession(app);

  try {
    const recoveredResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/profiles/${profileId}/run`,
        headers,
      });
    expect(recoveredResponse.statusCode).toBe(200);
    expect(
      browserRunStateResponseSchema.parse(recoveredResponse.json()).run,
    ).toMatchObject({ id: recoveryRunId, status: "running" });

    const sameProfileStart = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/start`,
        headers,
      });
    expect(sameProfileStart.statusCode).toBe(409);
    expect(apiErrorSchema.parse(sameProfileStart.json()).error.code).toBe(
      "ACTIVE_BROWSER_RUN_CONFLICT",
    );

    const otherProfileStart = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${secondProfileId}/start`,
        headers,
      });
    expect(otherProfileStart.statusCode).toBe(202);
    await vi.waitFor(async () => {
      const otherProfileState = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "GET",
          url: `/profiles/${secondProfileId}/run`,
          headers,
        });
      expect(
        browserRunStateResponseSchema.parse(otherProfileState.json()).run?.status,
      ).toBe("running");
    });
    expect(runtime.launchCalls).toHaveLength(1);
    expect(runtime.launchCalls[0]?.profileId).toBe(secondProfileId);
  } finally {
    await app.close();
  }
});

test("unknown recovery stays blocked while another profile can start through the API", async () => {
  const repositories = createRepositories([secondProfile]);
  await repositories.runs.create(
    createRecoveryRun(4700, `${profileId}:${recoveryRunId}:fake-process-001`),
  );
  const runtime = new FakeBrowserRuntime({ firstPid: 4800 });
  const { app, lifecycle } = await openRuntimeApp(runtime, repositories);
  await lifecycle.recoverPersistedRuns();
  const headers = await establishSession(app);

  try {
    const healthResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/health",
      headers: requestHeaders,
    });
    expect(healthResponse.statusCode).toBe(200);

    const unknownRunResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/profiles/${profileId}/run`,
        headers,
      });
    expect(unknownRunResponse.statusCode).toBe(200);
    expect(
      browserRunStateResponseSchema.parse(unknownRunResponse.json()).run,
    ).toMatchObject({ id: recoveryRunId, status: "recovery_required" });

    const sameProfileStart = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/start`,
        headers,
      });
    expect(sameProfileStart.statusCode).toBe(409);
    expect(apiErrorSchema.parse(sameProfileStart.json()).error.code).toBe(
      "ACTIVE_BROWSER_RUN_CONFLICT",
    );

    const otherProfileStart = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${secondProfileId}/start`,
        headers,
      });
    expect(otherProfileStart.statusCode).toBe(202);
    await vi.waitFor(async () => {
      const otherProfileState = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "GET",
          url: `/profiles/${secondProfileId}/run`,
          headers,
        });
      expect(
        browserRunStateResponseSchema.parse(otherProfileState.json()).run?.status,
      ).toBe("running");
    });
    expect(runtime.launchCalls).toHaveLength(1);
    expect(runtime.launchCalls[0]?.profileId).toBe(secondProfileId);
  } finally {
    await app.close();
  }
});

test("recovery reports a browser exit that happened while the API was offline", async () => {
  const processHost = new FakeBrowserProcessHost();
  const previousRuntime = new FakeBrowserRuntime({ processHost, firstPid: 4900 });
  const repositories = createRepositories();
  const processHandle = await (async (): Promise<RuntimeProcess> => {
    const previous = await openRuntimeApp(previousRuntime, repositories);
    const previousHeaders = await establishSession(previous.app);

    try {
      const startResponse = await previous.app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: `/profiles/${profileId}/start`,
          headers: previousHeaders,
        });
      expect(startResponse.statusCode).toBe(202);

      await vi.waitFor(async () => {
        const state = await previous.app
          .getHttpAdapter()
          .getInstance()
          .inject({
            method: "GET",
            url: `/profiles/${profileId}/run`,
            headers: previousHeaders,
          });
        expect(browserRunStateResponseSchema.parse(state.json()).run?.status).toBe(
          "running",
        );
      });
    } finally {
      await previous.app.close();
    }

    const process = previousRuntime.activeProcesses()[0];
    if (process === undefined) {
      throw new Error("Expected the fake browser process to remain after API close");
    }
    return process;
  })();

  processHost.simulateApiProcessExit();
  previousRuntime.emitUnexpectedExit(processHandle, { code: 0, signal: null });

  const restartedRuntime = new FakeBrowserRuntime({ processHost, firstPid: 5000 });
  const restarted = await openRuntimeApp(restartedRuntime, repositories);
  await restarted.lifecycle.recoverPersistedRuns();
  const restartedHeaders = await establishSession(restarted.app);

  try {
    const recoveredResponse = await restarted.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/profiles/${profileId}/run`,
        headers: restartedHeaders,
      });
    expect(recoveredResponse.statusCode).toBe(200);
    expect(
      browserRunStateResponseSchema.parse(recoveredResponse.json()).run,
    ).toMatchObject({ status: "failed" });

    const startAfterRecovery = await restarted.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/start`,
        headers: restartedHeaders,
      });
    expect(startAfterRecovery.statusCode).toBe(202);
    await vi.waitFor(async () => {
      const state = await restarted.app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "GET",
          url: `/profiles/${profileId}/run`,
          headers: restartedHeaders,
        });
      expect(browserRunStateResponseSchema.parse(state.json()).run?.status).toBe(
        "running",
      );
    });
    expect(restartedRuntime.launchCalls).toHaveLength(1);
  } finally {
    await restarted.app.close();
  }
});

test("application shutdown leaves a running browser alive for recovery", async () => {
  const processHost = new FakeBrowserProcessHost();
  const previousRuntime = new FakeBrowserRuntime({ processHost, firstPid: 5100 });
  const repositories = createRepositories();
  const previous = await openRuntimeApp(previousRuntime, repositories);
  const previousHeaders = await establishSession(previous.app);

  try {
    const startResponse = await previous.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/start`,
        headers: previousHeaders,
      });
    expect(startResponse.statusCode).toBe(202);
    await vi.waitFor(async () => {
      const state = await previous.app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "GET",
          url: `/profiles/${profileId}/run`,
          headers: previousHeaders,
        });
      expect(browserRunStateResponseSchema.parse(state.json()).run?.status).toBe(
        "running",
      );
    });
  } finally {
    await previous.app.close();
  }

  await expect(previous.lifecycle.start(profileId)).rejects.toThrow(
    "Browser lifecycle is shutting down",
  );
  expect(previousRuntime.stopCalls).toEqual([]);
  expect(previousRuntime.activeProcesses()).toHaveLength(1);
  processHost.simulateApiProcessExit();

  const restartedRuntime = new FakeBrowserRuntime({ processHost, firstPid: 5200 });
  const restarted = await openRuntimeApp(restartedRuntime, repositories);
  await expect(restarted.lifecycle.recoverPersistedRuns()).resolves.toMatchObject([
    { status: "running", processPid: 5100 },
  ]);
  const restartedHeaders = await establishSession(restarted.app);

  try {
    const sameProfileStart = await restarted.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/start`,
        headers: restartedHeaders,
      });
    expect(sameProfileStart.statusCode).toBe(409);
    expect(restartedRuntime.launchCalls).toEqual([]);
  } finally {
    await restarted.app.close();
  }
});

test("stop during starting returns a fast conflict without stopping the process", async () => {
  const fake = new FakeBrowserRuntime();
  let releaseLaunch!: () => void;
  const launchGate = new Promise<void>((resolve) => {
    releaseLaunch = resolve;
  });
  const runtime: BrowserRuntime = {
    async launch(input: RuntimeLaunchInput): Promise<RuntimeLaunchResult> {
      await launchGate;
      return fake.launch(input);
    },
    recover(input: RuntimeRecoveryInput): Promise<RuntimeRecoveryResult> {
      return fake.recover(input);
    },
    stop(
      process: RuntimeProcess,
      options: RuntimeStopOptions,
    ): Promise<RuntimeStopResult> {
      return fake.stop(process, options);
    },
  };
  const { app } = await openRuntimeApp(runtime);
  const headers = await establishSession(app);

  try {
    const start = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/start`,
        headers,
      });
    expect(start.statusCode).toBe(202);
    expect(browserRunStateResponseSchema.parse(start.json()).run?.status).toBe(
      "starting",
    );

    const stop = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${profileId}/stop`,
        headers,
      });
    expect(stop.statusCode).toBe(409);
    expect(apiErrorSchema.parse(stop.json()).error.code).toBe(
      "BROWSER_RUN_START_IN_PROGRESS",
    );
    expect(fake.stopCalls).toHaveLength(0);

    releaseLaunch();
    await vi.waitFor(async () => {
      const state = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "GET",
          url: `/profiles/${profileId}/run`,
          headers,
        });
      expect(browserRunStateResponseSchema.parse(state.json()).run?.status).toBe(
        "running",
      );
    });
  } finally {
    releaseLaunch();
    await app.close();
  }
});

test("updates fingerprint mode through the session-protected API without starting a browser", async () => {
  const runtime = new FakeBrowserRuntime({ firstPid: 5100 });
  const { app } = await openRuntimeApp(runtime);
  const headers = await establishSession(app);

  try {
    const unauthenticatedResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${profileId}/fingerprint`,
        headers: requestHeaders,
        payload: { fingerprintEnabled: false },
      });
    expect(unauthenticatedResponse.statusCode).toBe(401);

    const openApiResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/docs-json",
      headers: requestHeaders,
    });
    const openApiDocument = openApiResponse.json() as {
      paths: Record<string, { patch?: { responses: Record<string, unknown> } }>;
    };
    expect(
      openApiDocument.paths["/profiles/{profileId}/fingerprint"]?.patch?.responses,
    ).toHaveProperty("200");
    expect(
      openApiDocument.paths["/profiles/{profileId}/fingerprint"]?.patch?.responses,
    ).toHaveProperty("409");
    expect(
      openApiDocument.paths["/profiles/{profileId}/fingerprint"]?.patch?.responses,
    ).toHaveProperty("503");

    const disabledResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${profileId}/fingerprint`,
        headers,
        payload: { fingerprintEnabled: false },
      });
    expect(disabledResponse.statusCode).toBe(200);
    expect(profileResponseSchema.parse(disabledResponse.json())).toMatchObject({
      id: profileId,
      fingerprintEnabled: false,
      identityRef: "test-identity:runtime",
    });

    const reenabledResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${profileId}/fingerprint`,
        headers,
        payload: { fingerprintEnabled: true },
      });
    expect(reenabledResponse.statusCode).toBe(200);
    expect(profileResponseSchema.parse(reenabledResponse.json())).toMatchObject({
      fingerprintEnabled: true,
      identityRef: "test-identity:runtime",
    });

    const invalidBodyResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${profileId}/fingerprint`,
        headers,
        payload: { fingerprintEnabled: false, identityRef: "client-value" },
      });
    expect(invalidBodyResponse.statusCode).toBe(400);
    expect(apiErrorSchema.parse(invalidBodyResponse.json()).error.code).toBe(
      "VALIDATION_ERROR",
    );

    const missingProfileResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: "/profiles/00000000-0000-4000-8000-000000000099/fingerprint",
        headers,
        payload: { fingerprintEnabled: false },
      });
    expect(missingProfileResponse.statusCode).toBe(404);
    expect(apiErrorSchema.parse(missingProfileResponse.json()).error.code).toBe(
      "PROFILE_NOT_FOUND",
    );

    expect(runtime.launchCalls).toEqual([]);
  } finally {
    await app.close();
  }
});

test("generates and atomically persists a fingerprint when enabling a profile without one", async () => {
  const profileWithoutFingerprint: Profile = {
    ...secondProfile,
    fingerprintEnabled: false,
    identityRef: null,
  };
  const repositories = createRepositories([profileWithoutFingerprint]);
  const generatedConfig = {
    navigator: { platform: "Windows", languages: ["en-US"] },
  };
  const fingerprintGenerator: FingerprintGenerator = {
    generate: vi.fn(async () => generatedConfig),
  };
  const runtime = new FakeBrowserRuntime({ firstPid: 5200 });
  const { app } = await openRuntimeApp(runtime, repositories, fingerprintGenerator);
  const headers = await establishSession(app);

  try {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${secondProfileId}/fingerprint`,
        headers,
        payload: { fingerprintEnabled: true },
      });
    const updatedProfile = profileResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(updatedProfile).toMatchObject({
      id: secondProfileId,
      fingerprintEnabled: true,
    });
    expect(updatedProfile.identityRef).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(fingerprintGenerator.generate).toHaveBeenCalledExactlyOnceWith(
      updatedProfile.identityRef,
      "Windows",
    );
    expect(repositories.identities.get(updatedProfile.identityRef!)).toMatchObject({
      config: generatedConfig,
    });
    expect(runtime.launchCalls).toEqual([]);
  } finally {
    await app.close();
  }
});

test("replaces fingerprint identity through the session-protected API without launching a browser", async () => {
  const disabledProfile: Profile = {
    ...secondProfile,
    fingerprintEnabled: false,
  };
  const repositories = createRepositories([disabledProfile]);
  const generatedConfig = {
    navigator: { platform: "Windows", languages: ["en-US"] },
  };
  const fingerprintGenerator: FingerprintGenerator = {
    generate: vi.fn(async () => generatedConfig),
  };
  const runtime = new FakeBrowserRuntime();
  const { app } = await openRuntimeApp(runtime, repositories, fingerprintGenerator);
  const headers = await establishSession(app);

  try {
    const unauthenticatedResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${secondProfileId}/fingerprint/replace`,
        headers: requestHeaders,
      });
    expect(unauthenticatedResponse.statusCode).toBe(401);

    const openApiResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/docs-json",
      headers,
    });
    const openApiDocument = openApiResponse.json() as {
      paths: Record<string, { post?: { responses: Record<string, unknown> } }>;
    };
    const responses =
      openApiDocument.paths["/profiles/{profileId}/fingerprint/replace"]?.post
        ?.responses;
    expect(responses).toHaveProperty("200");
    expect(responses).toHaveProperty("409");
    expect(responses).toHaveProperty("503");

    const missingProfileResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/profiles/00000000-0000-4000-8000-000000000099/fingerprint/replace",
      headers,
    });
    expect(missingProfileResponse.statusCode).toBe(404);
    expect(apiErrorSchema.parse(missingProfileResponse.json()).error.code).toBe(
      "PROFILE_NOT_FOUND",
    );

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: `/profiles/${secondProfileId}/fingerprint/replace`,
        headers,
      });
    const updatedProfile = profileResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(updatedProfile).toMatchObject({
      id: secondProfileId,
      fingerprintEnabled: false,
    });
    expect(updatedProfile.identityRef).not.toBe(disabledProfile.identityRef);
    expect(fingerprintGenerator.generate).toHaveBeenCalledExactlyOnceWith(
      updatedProfile.identityRef,
      "Windows",
    );
    expect(repositories.identities.get(updatedProfile.identityRef!)).toMatchObject({
      config: generatedConfig,
    });
    expect(runtime.launchCalls).toEqual([]);
  } finally {
    await app.close();
  }
});

test("changes a disabled profile platform and generates a matching identity when enabled", async () => {
  const disabledProfile: Profile = {
    ...secondProfile,
    fingerprintEnabled: false,
  };
  const repositories = createRepositories([disabledProfile]);
  const previousIdentity: FingerprintIdentity = {
    id: disabledProfile.identityRef!,
    formatVersion: 1,
    config: { navigator: { platform: "Windows", languages: ["en-US"] } },
    createdAt: disabledProfile.createdAt,
  };
  repositories.identities.set(previousIdentity.id, previousIdentity);
  const fingerprintGenerator: FingerprintGenerator = {
    generate: vi.fn(async (_identityId: string, platform = "Windows") => ({
      navigator: { platform, languages: ["en-US"] },
    })),
  };
  const runtime = new FakeBrowserRuntime();
  const { app } = await openRuntimeApp(runtime, repositories, fingerprintGenerator);
  const headers = await establishSession(app);

  try {
    const unauthenticatedResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${secondProfileId}/fingerprint/platform`,
        headers: requestHeaders,
        payload: { fingerprintPlatform: "macOS" },
      });
    expect(unauthenticatedResponse.statusCode).toBe(401);

    const invalidPlatformResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${secondProfileId}/fingerprint/platform`,
        headers,
        payload: { fingerprintPlatform: "Android" },
      });
    expect(invalidPlatformResponse.statusCode).toBe(400);
    expect(apiErrorSchema.parse(invalidPlatformResponse.json()).error.code).toBe(
      "VALIDATION_ERROR",
    );

    const openApiResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/docs-json",
      headers,
    });
    const openApiDocument = openApiResponse.json() as {
      paths: Record<string, { patch?: { responses: Record<string, unknown> } }>;
    };
    const platformResponses =
      openApiDocument.paths["/profiles/{profileId}/fingerprint/platform"]?.patch
        ?.responses;
    expect(platformResponses).toHaveProperty("200");
    expect(platformResponses).toHaveProperty("400");
    expect(platformResponses).toHaveProperty("404");
    expect(platformResponses).toHaveProperty("409");
    expect(platformResponses).toHaveProperty("503");

    const platformResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${secondProfileId}/fingerprint/platform`,
        headers,
        payload: { fingerprintPlatform: "macOS" },
      });
    expect(platformResponse.statusCode, platformResponse.body).toBe(200);
    const platformProfile = profileResponseSchema.parse(platformResponse.json());
    expect(platformProfile).toMatchObject({
      fingerprintPlatform: "macOS",
      fingerprintEnabled: false,
      identityRef: null,
    });
    expect(fingerprintGenerator.generate).not.toHaveBeenCalled();
    expect(repositories.identities.get(previousIdentity.id)).toEqual(previousIdentity);

    const enableResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${secondProfileId}/fingerprint`,
        headers,
        payload: { fingerprintEnabled: true },
      });
    expect(enableResponse.statusCode, enableResponse.body).toBe(200);
    const enabledProfile = profileResponseSchema.parse(enableResponse.json());
    expect(enabledProfile).toMatchObject({
      fingerprintPlatform: "macOS",
      fingerprintEnabled: true,
    });
    expect(enabledProfile.identityRef).not.toBe(previousIdentity.id);
    expect(fingerprintGenerator.generate).toHaveBeenCalledExactlyOnceWith(
      enabledProfile.identityRef,
      "macOS",
    );
    expect(repositories.identities.get(enabledProfile.identityRef!)).toMatchObject({
      config: { navigator: { platform: "macOS" } },
    });
    expect(runtime.launchCalls).toEqual([]);
  } finally {
    await app.close();
  }
});

test("returns a safe 503 and preserves a profile when fingerprint generation is unavailable", async () => {
  const profileWithoutFingerprint: Profile = {
    ...secondProfile,
    fingerprintEnabled: false,
    identityRef: null,
  };
  const repositories = createRepositories([profileWithoutFingerprint]);
  const fingerprintGenerator: FingerprintGenerator = {
    async generate() {
      throw new FingerprintGenerationError("RUNTIME_NOT_INSTALLED");
    },
  };
  const { app } = await openRuntimeApp(
    new FakeBrowserRuntime(),
    repositories,
    fingerprintGenerator,
  );
  const headers = await establishSession(app);

  try {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${secondProfileId}/fingerprint`,
        headers,
        payload: { fingerprintEnabled: true },
      });

    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json())).toEqual({
      error: {
        code: "FINGERPRINT_RUNTIME_NOT_READY",
        message: "Fingerprint runtime is not installed or is incomplete",
      },
    });
    await expect(repositories.profiles.findById(secondProfileId)).resolves.toEqual(
      profileWithoutFingerprint,
    );
    expect(repositories.identities.size).toBe(0);
  } finally {
    await app.close();
  }
});

test("fingerprint mode cannot change while a profile is occupied", async () => {
  const repositories = createRepositories();
  await repositories.runs.create(createRecoveryRun(5200, "fake-process-identity"));
  const runtime = new FakeBrowserRuntime({ firstPid: 5300 });
  const { app } = await openRuntimeApp(runtime, repositories);
  const headers = await establishSession(app);

  try {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        url: `/profiles/${profileId}/fingerprint`,
        headers,
        payload: { fingerprintEnabled: false },
      });

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe(
      "ACTIVE_BROWSER_RUN_CONFLICT",
    );
    expect(runtime.launchCalls).toEqual([]);

    const profileResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/profiles/${profileId}`,
        headers,
      });
    expect(profileResponseSchema.parse(profileResponse.json())).toMatchObject({
      fingerprintEnabled: true,
      identityRef: "test-identity:runtime",
    });
  } finally {
    await app.close();
  }
});
