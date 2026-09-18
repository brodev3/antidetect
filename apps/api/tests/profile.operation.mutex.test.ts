import { describe, expect, test } from "vitest";
import { ProfileOperationMutex } from "../src/application/lifecycle/profile.operation.mutex.ts";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });

  return { promise, resolve };
}

describe("ProfileOperationMutex", () => {
  test("serializes operations for the same profile", async () => {
    const mutex = new ProfileOperationMutex();
    const gate = deferred();
    const events: string[] = [];

    const first = mutex.runExclusive("profile-001", async () => {
      events.push("first-start");
      await gate.promise;
      events.push("first-end");
    });
    await Promise.resolve();

    const second = mutex.runExclusive("profile-001", async () => {
      events.push("second-start");
    });
    await Promise.resolve();

    expect(events).toEqual(["first-start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });

  test("does not globally block different profiles", async () => {
    const mutex = new ProfileOperationMutex();
    const gate = deferred();
    const events: string[] = [];

    const first = mutex.runExclusive("profile-001", async () => {
      events.push("first-start");
      await gate.promise;
    });
    await Promise.resolve();

    const second = mutex.runExclusive("profile-002", async () => {
      events.push("second-start");
    });
    await second;
    expect(events).toEqual(["first-start", "second-start"]);

    gate.resolve();
    await first;
  });

  test("releases the profile after an operation fails", async () => {
    const mutex = new ProfileOperationMutex();

    await expect(
      mutex.runExclusive("profile-001", async () => {
        throw new Error("operation failed");
      }),
    ).rejects.toThrow("operation failed");

    await expect(
      mutex.runExclusive("profile-001", async () => "next-operation"),
    ).resolves.toBe("next-operation");
  });

  test("rejects an empty profile id", async () => {
    const mutex = new ProfileOperationMutex();

    await expect(mutex.runExclusive("  ", async () => undefined)).rejects.toThrow(
      "profileId must not be empty",
    );
  });
});
