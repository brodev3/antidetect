import { expect, test, vi } from "vitest";
import { createApiRuntime } from "../src/infrastructure/lifecycle/api.runtime.ts";

test("closes the application before releasing root ownership", async () => {
  const calls: string[] = [];
  const app = {
    close: async (): Promise<void> => {
      calls.push("app.close");
    },
  };
  const rootOwnership = {
    close: (): void => {
      calls.push("root.close");
    },
  };

  const runtime = createApiRuntime(app, rootOwnership);

  await runtime.close();

  expect(calls).toEqual(["app.close", "root.close"]);
});

test("makes repeated close calls idempotent", async () => {
  let applicationCloseCount = 0;
  let rootCloseCount = 0;
  const app = {
    close: async (): Promise<void> => {
      applicationCloseCount += 1;
    },
  };
  const rootOwnership = {
    close: (): void => {
      rootCloseCount += 1;
    },
  };
  const runtime = createApiRuntime(app, rootOwnership);

  const firstClose = runtime.close();
  const secondClose = runtime.close();

  expect(secondClose).toBe(firstClose);
  await Promise.all([firstClose, secondClose]);

  expect(applicationCloseCount).toBe(1);
  expect(rootCloseCount).toBe(1);
});

test("retains root ownership when application close fails", async () => {
  let rootCloseCount = 0;
  const rootOwnership = {
    close: (): void => {
      rootCloseCount += 1;
    },
  };
  const closeError = new Error("application close failed");
  const app = {
    close: async (): Promise<void> => {
      throw closeError;
    },
  };
  const runtime = createApiRuntime(app, rootOwnership);

  await expect(runtime.close()).rejects.toBe(closeError);
  expect(rootCloseCount).toBe(0);
});

test("fails closed when application close exceeds the timeout", async () => {
  vi.useFakeTimers();

  try {
    let rootCloseCount = 0;
    const app = {
      close: (): Promise<void> => new Promise(() => undefined),
    };
    const rootOwnership = {
      close: (): void => {
        rootCloseCount += 1;
      },
    };
    const runtime = createApiRuntime(app, rootOwnership, {
      closeTimeoutMs: 50,
    });

    const closePromise = runtime.close();
    const rejection = expect(closePromise).rejects.toMatchObject({
      name: "ApiShutdownTimeoutError",
    });

    await vi.advanceTimersByTimeAsync(50);
    await rejection;

    expect(rootCloseCount).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
