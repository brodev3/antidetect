export interface Profile {
  readonly id: string;
  readonly profileCode: string;
  readonly displayName: string;
  readonly identityRef: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProfileDraft {
  readonly id: string;
  readonly displayName: string;
  readonly identityRef: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProfileListOptions {
  readonly limit: number;
  readonly offset: number;
  readonly search?: string;
  readonly sortBy: ProfileListSortBy;
  readonly sortOrder: ProfileListSortOrder;
}

export type ProfileListSortBy = "createdAt" | "displayName";
export type ProfileListSortOrder = "asc" | "desc";

export interface ProfileRepository {
  create(profile: ProfileDraft): Promise<Profile>;
  findById(id: string): Promise<Profile | null>;
  list(options: ProfileListOptions): Promise<readonly Profile[]>;
}
