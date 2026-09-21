import { randomUUID } from "node:crypto";
import { ProfileNotFoundError } from "./profile.errors.js";
import type {
  Profile,
  ProfileListSortBy,
  ProfileListSortOrder,
  ProfileRepository,
} from "./profile.repository.js";

export interface CreateProfileInput {
  readonly displayName: string;
}

export interface ListProfilesInput {
  readonly limit: number;
  readonly offset: number;
  readonly search: string | undefined;
  readonly sortBy: ProfileListSortBy;
  readonly sortOrder: ProfileListSortOrder;
}

export interface ListProfilesResult {
  readonly items: readonly Profile[];
  readonly nextOffset: number | null;
}

export interface ProfileServiceDependencies {
  readonly createId: () => string;
  readonly now: () => string;
}

const defaultDependencies: ProfileServiceDependencies = {
  createId: randomUUID,
  now: () => new Date().toISOString(),
};

export class ProfileService {
  constructor(
    private readonly repository: ProfileRepository,
    private readonly dependencies: ProfileServiceDependencies = defaultDependencies,
  ) {}

  async create(input: CreateProfileInput): Promise<Profile> {
    const id = this.dependencies.createId();
    const timestamp = this.dependencies.now();

    return this.repository.create({
      id,
      displayName: input.displayName,
      identityRef: `test-identity:${id}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async getById(profileId: string): Promise<Profile> {
    const profile = await this.repository.findById(profileId);

    if (profile === null) {
      throw new ProfileNotFoundError(profileId);
    }

    return profile;
  }

  async list(input: ListProfilesInput): Promise<ListProfilesResult> {
    const options = {
      limit: input.limit + 1,
      offset: input.offset,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    } as const;
    const profiles = await this.repository.list(
      input.search === undefined ? options : { ...options, search: input.search },
    );
    const hasNextPage = profiles.length > input.limit;

    return {
      items: profiles.slice(0, input.limit),
      nextOffset: hasNextPage ? input.offset + input.limit : null,
    };
  }
}
