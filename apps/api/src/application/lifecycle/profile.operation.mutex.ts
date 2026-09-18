export class ProfileOperationMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
    if (profileId.trim().length === 0) {
      throw new TypeError("profileId must not be empty");
    }

    const previous = this.tails.get(profileId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(profileId, tail);

    await previous;

    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(profileId) === tail) {
        this.tails.delete(profileId);
      }
    }
  }
}
