export interface ApiApplication {
  close(): Promise<void>;
}

export interface RootOwnershipReleaser {
  close(): void;
}

export interface ApiRuntime {
  close(): Promise<void>;
}

export interface ApiRuntimeOptions {
  closeTimeoutMs?: number;
}

export class ApiShutdownTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`API application close timed out after ${timeoutMs}ms`);
    this.name = "ApiShutdownTimeoutError";
  }
}

const defaultCloseTimeoutMs = 10_000;

async function closeApplication(app: ApiApplication, timeoutMs: number): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new ApiShutdownTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    await Promise.race([app.close(), timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function createApiRuntime(
  app: ApiApplication,
  rootOwnership: RootOwnershipReleaser,
  options: ApiRuntimeOptions = {},
): ApiRuntime {
  const closeTimeoutMs = options.closeTimeoutMs ?? defaultCloseTimeoutMs;
  let closePromise: Promise<void> | undefined;

  return {
    close(): Promise<void> {
      closePromise ??= (async () => {
        await closeApplication(app, closeTimeoutMs);
        rootOwnership.close();
      })();

      return closePromise;
    },
  };
}
