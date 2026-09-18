export class ProfileNotFoundError extends Error {
  readonly code = "PROFILE_NOT_FOUND" as const;

  constructor(readonly profileId: string) {
    super(`Profile ${profileId} was not found`);
    this.name = "ProfileNotFoundError";
  }
}
