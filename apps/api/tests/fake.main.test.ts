import { expect, test, vi } from "vitest";
import type { BuildAppOptions } from "../src/app.ts";

const app = vi.hoisted(() => ({
  listen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));
const buildApp = vi.hoisted(() =>
  vi.fn<(options: BuildAppOptions) => Promise<typeof app>>(),
);

vi.mock("../src/app.ts", () => ({ buildApp }));

test("fake entrypoint starts without an application root or Windows path environment", async () => {
  const initialSigintListeners = process.listeners("SIGINT");
  const initialSigtermListeners = process.listeners("SIGTERM");
  vi.stubEnv("ANTIDETECT_HOME", undefined);
  vi.stubEnv("LOCALAPPDATA", undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  buildApp.mockResolvedValue(app);

  try {
    await import("../src/fake.main.ts");

    expect(buildApp).toHaveBeenCalledOnce();
    const options = buildApp.mock.calls[0]![0];
    expect(options.browserLifecycleService).toBeDefined();
    expect(options).not.toHaveProperty("engineStatusReader");
    expect(app.listen).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 3000,
      allowedOrigins: ["http://127.0.0.1:5173"],
    });
  } finally {
    for (const listener of process.listeners("SIGINT")) {
      if (!initialSigintListeners.includes(listener)) process.off("SIGINT", listener);
    }
    for (const listener of process.listeners("SIGTERM")) {
      if (!initialSigtermListeners.includes(listener)) process.off("SIGTERM", listener);
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
});
