import { buildApp } from "./app.js";
import type {
  BrowserRun,
  BrowserRunRepository,
} from "./application/browserRuns/browser.run.repository.js";
import { BrowserLifecycleService } from "./application/browserRuns/browser.lifecycle.service.js";
import type {
  Profile,
  ProfileDraft,
  ProfileFingerprintSettings,
  ProfileListOptions,
  ProfileRepository,
} from "./application/profiles/profile.repository.js";
import { FakeBrowserRuntime } from "./infrastructure/runtime/fake.browser.runtime.js";

const fakeApiConfig = {
  host: "127.0.0.1",
  port: 3000,
  allowedOrigins: ["http://127.0.0.1:5173"],
} as const;
const fakeProfileId = "00000000-0000-4000-8000-000000000001";
const seedTimestamp = "2026-09-26T00:00:00.000Z";

class FakeProfileRepository implements ProfileRepository {
  private readonly profiles = new Map<string, Profile>([
    [
      fakeProfileId,
      {
        id: fakeProfileId,
        profileCode: "profile-001",
        displayName: "Fake runtime profile",
        fingerprintEnabled: true,
        identityRef: `test-identity:${fakeProfileId}`,
        createdAt: seedTimestamp,
        updatedAt: seedTimestamp,
      },
    ],
  ]);
  private nextProfileCode = 2;

  async create(draft: ProfileDraft): Promise<Profile> {
    const profile: Profile = {
      ...draft,
      profileCode: `profile-${String(this.nextProfileCode).padStart(3, "0")}`,
    };
    this.nextProfileCode += 1;
    this.profiles.set(profile.id, profile);
    return profile;
  }

  async findById(profileId: string): Promise<Profile | null> {
    return this.profiles.get(profileId) ?? null;
  }

  async updateFingerprintSettings(
    profileId: string,
    settings: ProfileFingerprintSettings,
  ): Promise<Profile | null> {
    const profile = this.profiles.get(profileId);
    if (profile === undefined) return null;

    const updatedProfile = { ...profile, ...settings };
    this.profiles.set(profileId, updatedProfile);
    return updatedProfile;
  }

  async list(options: ProfileListOptions): Promise<readonly Profile[]> {
    const search = options.search?.toLocaleLowerCase("en-US");
    const filtered = [...this.profiles.values()].filter(
      (profile) =>
        search === undefined ||
        profile.displayName.toLocaleLowerCase("en-US").includes(search),
    );
    const direction = options.sortOrder === "asc" ? 1 : -1;
    filtered.sort((left, right) => {
      const comparison =
        options.sortBy === "displayName"
          ? left.displayName.localeCompare(right.displayName)
          : left.createdAt.localeCompare(right.createdAt);
      return comparison === 0
        ? left.id.localeCompare(right.id)
        : comparison * direction;
    });

    return filtered.slice(options.offset, options.offset + options.limit);
  }
}

class FakeBrowserRunRepository implements BrowserRunRepository {
  private readonly runs = new Map<string, BrowserRun>();

  async create(run: BrowserRun): Promise<BrowserRun> {
    this.runs.set(run.id, run);
    return run;
  }

  async findById(runId: string): Promise<BrowserRun | null> {
    return this.runs.get(runId) ?? null;
  }

  async findActiveByProfileId(profileId: string): Promise<BrowserRun | null> {
    return (
      [...this.runs.values()].find(
        (run) =>
          run.profileId === profileId &&
          ["starting", "running", "stopping", "recovery_required"].includes(run.status),
      ) ?? null
    );
  }

  async findLatestByProfileId(profileId: string): Promise<BrowserRun | null> {
    return (
      [...this.runs.values()].filter((run) => run.profileId === profileId).at(-1) ??
      null
    );
  }

  async listOccupying(): Promise<readonly BrowserRun[]> {
    return [...this.runs.values()].filter((run) =>
      ["starting", "running", "stopping", "recovery_required"].includes(run.status),
    );
  }

  async save(run: BrowserRun): Promise<BrowserRun> {
    this.runs.set(run.id, run);
    return run;
  }
}

const profiles = new FakeProfileRepository();
const lifecycle = new BrowserLifecycleService(
  profiles,
  new FakeBrowserRunRepository(),
  new FakeBrowserRuntime(),
  undefined,
  { profileDirectoryFor: (profileId) => `fake-profile://${profileId}` },
);
const app = await buildApp({
  config: fakeApiConfig,
  profileRepository: profiles,
  browserLifecycleService: lifecycle,
});

await app.listen(fakeApiConfig);
console.info(
  `Fake browser API listening on http://${fakeApiConfig.host}:${fakeApiConfig.port}; no real browser is started`,
);

let closePromise: Promise<void> | undefined;
const close = (signal: NodeJS.Signals): void => {
  closePromise ??= app.close().then(() => {
    console.info(`Fake browser API stopped after ${signal}`);
  });
  void closePromise.catch((error: unknown) => {
    console.error(`Fake browser API shutdown failed after ${signal}`, error);
    process.exitCode = 1;
  });
};

process.once("SIGINT", () => close("SIGINT"));
process.once("SIGTERM", () => close("SIGTERM"));
