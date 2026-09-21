export interface Profile {
  readonly id: string;
  readonly displayName: string;
  readonly identityRef: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProfileListOptions {
  readonly limit: number;
  readonly offset: number;
}

export interface ProfileRepository {
  create(profile: Profile): Promise<Profile>;
  findById(id: string): Promise<Profile | null>;
  list(options: ProfileListOptions): Promise<readonly Profile[]>;
}
