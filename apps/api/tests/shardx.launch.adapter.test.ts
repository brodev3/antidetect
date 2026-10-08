import { ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Profile, ShardX, Runtime, userDataDir } from "@proxyshard/shardx";
import { afterEach, expect, test, vi } from "vitest";
import type {
  BrowserRun,
  BrowserRunRepository,
} from "../src/application/browserRuns/browser.run.repository.ts";
import type { FingerprintIdentityRepository } from "../src/application/fingerprints/fingerprint.identity.repository.ts";
import type {
  RuntimeLaunchInput,
  RuntimeExit,
  RuntimeProcess,
} from "../src/application/runtime/browser.runtime.ts";
import {
  ShardXLaunchAdapter,
  type ShardXLaunchAdapterDependencies,
} from "../src/infrastructure/runtime/shardx.launch.adapter.ts";
import type { ShardXLaunchPreparer } from "../src/infrastructure/runtime/shardx.launch.preparation.ts";
import type { ShardXProcessInventory } from "../src/infrastructure/runtime/shardx.process.identity.ts";
import { resolveAppPaths } from "../src/config/app.paths.ts";
import { createShardXSdk } from "../src/infrastructure/runtime/shardx.sdk.ts";

const profileId = "550e8400-e29b-41d4-a716-446655440000";
const identityRef = "cf7c7db4-0b0b-470d-b0ca-2866505e95a1";
const runId = "5baa51af-9c91-47a9-bac1-f79e03f32d3b";
const timestamp = "2026-10-05T10:00:00.000Z";
const profileDirectory = `C:\\Antidetect\\profiles\\${profileId}`;
const executablePath = "C:\\Antidetect\\runtime\\ShardX-Windows\\chrome.exe";
const input: RuntimeLaunchInput = { runId, profileId, profileDirectory, identityRef };
const unknownLaunch = {
  status: "spawn_uncertain",
  failureCode: "RUNTIME_LAUNCH_STATE_UNKNOWN",
  process: null,
};
const unverifiedLaunch = {
  status: "spawn_uncertain",
  failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
  process: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function run(overrides: Partial<BrowserRun> = {}): BrowserRun {
  return {
    id: runId,
    profileId,
    status: "starting",
    processPid: null,
    processIdentity: null,
    failureCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    endedAt: null,
    ...overrides,
  };
}

function absent(): ShardXProcessInventory {
  return {
    processScanComplete: true,
    pendingLauncher: "none",
    processes: [],
    unattributedPotentialProcessCount: 0,
    cdpPort: null,
    cdpListeners: [],
  };
}

function present(
  overrides: Partial<ShardXProcessInventory> = {},
): ShardXProcessInventory {
  return {
    ...absent(),
    processes: [4242, 4243].map((pid) => ({
      pid,
      parentPid: pid === 4242 ? 1000 : 4242,
      executablePath,
      profileDirectory,
      createdAt: "2026-10-05T10:00:01.0000000Z",
    })),
    cdpPort: 4567,
    cdpListeners: [{ localAddress: "127.0.0.1", localPort: 4567, ownerPid: 4242 }],
    ...overrides,
  };
}

function available(inventory: ShardXProcessInventory) {
  return { status: "available", inventory } as const;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function fixture(useDefaultCloser = false) {
  const paths = {
    runtimeDir: "C:\\Antidetect\\runtime",
    profilesDir: "C:\\Antidetect\\profiles",
  };
  // A ChildProcess object without spawn: no OS process or browser is created.
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 4242, configurable: true });
  const session = {
    pid: 4242,
    userDataDir: profileDirectory,
    process: child,
    cdpUrl: "ws://127.0.0.1:4567/devtools/browser/test-session",
  };
  const sdk = {
    runtime: { binaryPath: executablePath },
    listProfiles: vi.fn<() => Promise<string[]>>().mockResolvedValue([]),
    launch: vi
      .fn<NonNullable<ShardXLaunchAdapterDependencies["sdk"]>["launch"]>()
      .mockResolvedValue(session),
  };
  const profile = new Profile({ navigator: { platform: "Windows" } }, profileId);
  const options = {
    userDataDir: profileDirectory,
    randomize: false,
    cdp: true,
    headless: false,
  } as const;
  const preparer = {
    prepareStored: vi
      .fn<ShardXLaunchPreparer["prepareStored"]>()
      .mockResolvedValue({ status: "prepared", profile, options }),
  };
  const identities = { findById: vi.fn<FingerprintIdentityRepository["findById"]>() };
  const runs = {
    findById: vi.fn<BrowserRunRepository["findById"]>().mockResolvedValue(run()),
  };
  const readInventory = vi
    .fn<NonNullable<ShardXLaunchAdapterDependencies["readInventory"]>>()
    .mockResolvedValue(available(absent()))
    .mockResolvedValueOnce(available(absent()))
    .mockResolvedValueOnce(available(present()));
  const closeBrowser = useDefaultCloser
    ? undefined
    : vi
        .fn<NonNullable<ShardXLaunchAdapterDependencies["closeBrowser"]>>()
        .mockResolvedValue();
  const adapter = new ShardXLaunchAdapter(paths, {
    sdk,
    preparer,
    identities,
    runs,
    readInventory,
    ...(closeBrowser === undefined ? {} : { closeBrowser }),
  });
  return {
    adapter,
    sdk,
    preparer,
    identities,
    runs,
    readInventory,
    closeBrowser,
    child,
    session,
    profile,
    options,
  };
}

async function startProcess(f: ReturnType<typeof fixture>): Promise<RuntimeProcess> {
  const result = await f.adapter.launch(input);
  if (result.status !== "started") throw new Error("Expected verified launch");
  return result.process;
}

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  closeCalls = 0;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSING;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  respond(payload: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

test("launches one prepared working copy and exposes only verified application metadata", async () => {
  const f = fixture();
  const result = await f.adapter.launch(input);
  expect(f.runs.findById).toHaveBeenCalledExactlyOnceWith(runId);
  expect(f.preparer.prepareStored).toHaveBeenCalledExactlyOnceWith(input, f.identities);
  expect(f.sdk.launch).toHaveBeenCalledExactlyOnceWith(f.profile, {
    ...f.options,
    userDataDir: "C:\\Antidetect\\profiles",
  });
  expect(f.readInventory).toHaveBeenCalledTimes(2);
  expect(f.readInventory).toHaveBeenCalledWith({
    executablePath,
    profileDirectory,
    pendingLauncher: "none",
  });
  expect(result.status).toBe("started");
  if (result.status !== "started") throw new Error("Expected verified launch");
  expect(result.process).toMatchObject({ pid: 4242, runtimeId: `${runId}:shardx` });
  expect(result.process.processIdentity).toMatch(/^shardx-process-v1:[a-f0-9]{64}$/);
  expect(Object.keys(result.process).sort()).toEqual([
    "onExit",
    "pid",
    "processIdentity",
    "runtimeId",
  ]);
  expect(JSON.stringify(result)).not.toContain(executablePath);
  expect(JSON.stringify(result)).not.toContain(profileDirectory);
});

test("closes over verified loopback CDP and reports stopped only after tree absence", async () => {
  const f = fixture();
  const process = await startProcess(f);
  const processKill = vi.spyOn(f.child, "kill");
  f.readInventory
    .mockReset()
    .mockResolvedValueOnce(available(present()))
    .mockResolvedValueOnce(available(present()))
    .mockResolvedValueOnce(available(absent()));
  const onExit = vi.fn();
  process.onExit(onExit);

  const stop = f.adapter.stop(process, { timeoutMs: 1000 });
  expect(f.adapter.stop(process, { timeoutMs: 1000 })).toBe(stop);
  await expect(stop).resolves.toEqual({
    status: "stopped",
    exit: { kind: "normal", code: null, signal: null },
  });
  expect(f.closeBrowser).toHaveBeenCalledExactlyOnceWith(
    "ws://127.0.0.1:4567/devtools/browser/test-session",
    expect.any(AbortSignal),
  );
  expect(onExit).toHaveBeenCalledExactlyOnceWith({
    kind: "normal",
    code: null,
    signal: null,
  });
  expect(f.readInventory).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(await stop)).not.toContain("test-session");
  expect(processKill).not.toHaveBeenCalled();
});

test("uses the built-in WebSocket client to send Browser.close and accepts its acknowledgement", async () => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  const f = fixture(true);
  const process = await startProcess(f);
  f.readInventory
    .mockReset()
    .mockResolvedValueOnce(available(present()))
    .mockResolvedValueOnce(available(absent()));

  const stopping = f.adapter.stop(process, { timeoutMs: 1000 });
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error("Expected CDP socket");
  expect(socket.url).toBe("ws://127.0.0.1:4567/devtools/browser/test-session");
  socket.open();
  expect(socket.sent).toEqual(['{"id":1,"method":"Browser.close"}']);
  socket.respond({ id: 1, result: {} });

  await expect(stopping).resolves.toEqual({
    status: "stopped",
    exit: { kind: "normal", code: null, signal: null },
  });
  expect(socket.closeCalls).toBe(1);
});

test("does not send CDP close when the listener is not owned by the verified process tree", async () => {
  const f = fixture();
  const process = await startProcess(f);
  f.readInventory.mockReset().mockResolvedValue(
    available(
      present({
        cdpListeners: [{ localAddress: "127.0.0.1", localPort: 4567, ownerPid: 9999 }],
      }),
    ),
  );

  await expect(f.adapter.stop(process, { timeoutMs: 1000 })).resolves.toEqual({
    status: "failed",
    failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
    exit: null,
  });
  expect(f.closeBrowser).not.toHaveBeenCalled();
});

test("does not use a non-loopback or mismatched CDP endpoint", async () => {
  const f = fixture();
  f.sdk.launch.mockResolvedValue({
    ...f.session,
    cdpUrl: "ws://192.0.2.7:4567/devtools/browser/foreign",
  });
  const launch = await f.adapter.launch(input);
  expect(launch.status).toBe("spawn_uncertain");
  if (launch.status !== "spawn_uncertain" || launch.process === null) {
    throw new Error("Expected an uncertain launch with a verified process handle");
  }
  f.readInventory.mockReset().mockResolvedValue(available(present()));

  await expect(f.adapter.stop(launch.process, { timeoutMs: 1000 })).resolves.toEqual({
    status: "failed",
    failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
    exit: null,
  });
  expect(f.closeBrowser).not.toHaveBeenCalled();
  expect(JSON.stringify(launch)).not.toContain("192.0.2.7");
});

test("does not claim stop when Browser.close is rejected", async () => {
  const f = fixture();
  const process = await startProcess(f);
  f.closeBrowser?.mockRejectedValue(new Error("private WebSocket endpoint"));
  f.readInventory.mockReset().mockResolvedValueOnce(available(present()));

  const stop = f.adapter.stop(process, { timeoutMs: 1000 });
  await expect(stop).resolves.toEqual({
    status: "failed",
    failureCode: "RUNTIME_CDP_CLOSE_FAILED",
    exit: null,
  });
  expect(JSON.stringify(await stop)).not.toContain("private WebSocket endpoint");
});

test("retries a completed stop failure after revalidating process ownership", async () => {
  const f = fixture();
  const process = await startProcess(f);
  f.closeBrowser?.mockRejectedValueOnce(new Error("private WebSocket endpoint"));
  f.readInventory
    .mockReset()
    .mockResolvedValueOnce(available(present()))
    .mockResolvedValueOnce(available(present()))
    .mockResolvedValueOnce(available(absent()));

  const firstStop = f.adapter.stop(process, { timeoutMs: 1000 });
  await expect(firstStop).resolves.toEqual({
    status: "failed",
    failureCode: "RUNTIME_CDP_CLOSE_FAILED",
    exit: null,
  });

  const retry = f.adapter.stop(process, { timeoutMs: 1000 });
  expect(retry).not.toBe(firstStop);
  await expect(retry).resolves.toEqual({
    status: "stopped",
    exit: { kind: "normal", code: null, signal: null },
  });
  expect(f.readInventory).toHaveBeenCalledTimes(3);
  expect(f.closeBrowser).toHaveBeenCalledTimes(2);
});

test("does not cache a stop call with an invalid timeout", async () => {
  const f = fixture();
  const process = await startProcess(f);
  f.readInventory
    .mockReset()
    .mockResolvedValueOnce(available(present()))
    .mockResolvedValueOnce(available(absent()));

  await expect(f.adapter.stop(process, { timeoutMs: 0 })).resolves.toEqual({
    status: "timed_out",
    failureCode: "RUNTIME_STOP_TIMEOUT",
    exit: null,
  });

  await expect(f.adapter.stop(process, { timeoutMs: 1000 })).resolves.toEqual({
    status: "stopped",
    exit: { kind: "normal", code: null, signal: null },
  });
  expect(f.readInventory).toHaveBeenCalledTimes(2);
  expect(f.closeBrowser).toHaveBeenCalledTimes(1);
});

test("uses a verified late exit instead of replaying an earlier stop timeout", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const process = await startProcess(f);
  const closeGate = deferred<void>();
  const closeEntered = deferred<void>();
  f.closeBrowser?.mockImplementationOnce(() => {
    closeEntered.resolve();
    return closeGate.promise;
  });
  f.readInventory
    .mockReset()
    .mockResolvedValueOnce(available(present()))
    .mockResolvedValueOnce(available(absent()));

  const stop = f.adapter.stop(process, { timeoutMs: 50 });
  await closeEntered.promise;
  await vi.advanceTimersByTimeAsync(50);
  await expect(stop).resolves.toEqual({
    status: "timed_out",
    failureCode: "RUNTIME_STOP_TIMEOUT",
    exit: null,
  });
  expect(f.adapter.stop(process, { timeoutMs: 1000 })).toBe(stop);

  const observedExit = deferred<RuntimeExit>();
  process.onExit(observedExit.resolve);
  f.child.emit("exit", 0, null);
  await expect(observedExit.promise).resolves.toEqual({
    kind: "unknown",
    code: 0,
    signal: null,
  });

  await expect(f.adapter.stop(process, { timeoutMs: 1000 })).resolves.toEqual({
    status: "stopped",
    exit: { kind: "unknown", code: 0, signal: null },
  });
  closeGate.resolve();
});

test("does not accept a CDP error response as a close acknowledgement", async () => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  const f = fixture(true);
  const process = await startProcess(f);
  f.readInventory.mockReset().mockResolvedValueOnce(available(present()));

  const stopping = f.adapter.stop(process, { timeoutMs: 1000 });
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const socket = FakeWebSocket.instances[0];
  if (socket === undefined) throw new Error("Expected CDP socket");
  socket.open();
  socket.respond({ id: 1, error: { code: -32000, message: "private endpoint" } });

  await expect(stopping).resolves.toEqual({
    status: "failed",
    failureCode: "RUNTIME_CDP_CLOSE_FAILED",
    exit: null,
  });
  expect(JSON.stringify(await stopping)).not.toContain("private endpoint");
  expect(f.readInventory).toHaveBeenCalledOnce();
});

test("returns timed_out while the owned process tree remains present", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const process = await startProcess(f);
  f.readInventory.mockReset().mockResolvedValue(available(present()));
  const stopping = f.adapter.stop(process, { timeoutMs: 500 });

  await vi.advanceTimersByTimeAsync(500);
  await expect(stopping).resolves.toEqual({
    status: "timed_out",
    failureCode: "RUNTIME_STOP_TIMEOUT",
    exit: null,
  });
  expect(f.closeBrowser).toHaveBeenCalledOnce();
});

test.each([
  null,
  run({ id: "another-run" }),
  run({ profileId: "another-profile" }),
  run({ status: "running" }),
  run({ endedAt: timestamp }),
  run({ createdAt: "invalid time" }),
])(
  "rejects missing or conflicting durable run metadata before SDK launch: %j",
  async (record) => {
    const f = fixture();
    f.runs.findById.mockResolvedValue(record);
    await expect(f.adapter.launch(input)).resolves.toEqual({
      status: "failed_before_spawn",
      failureCode: "RUNTIME_RUN_METADATA_UNAVAILABLE",
    });
    expect(f.preparer.prepareStored).not.toHaveBeenCalled();
    expect(f.sdk.launch).not.toHaveBeenCalled();
  },
);

test("redacts a failed durable run read", async () => {
  const f = fixture();
  f.runs.findById.mockRejectedValue(new Error("private database path"));
  await expect(f.adapter.launch(input)).resolves.toEqual({
    status: "failed_before_spawn",
    failureCode: "RUNTIME_RUN_METADATA_UNAVAILABLE",
  });
  expect(f.sdk.launch).not.toHaveBeenCalled();
});

test("preserves uncertainty for a run that already has process metadata", async () => {
  const f = fixture();
  f.runs.findById.mockResolvedValue(run({ processPid: 4242 }));
  await expect(f.adapter.launch(input)).resolves.toEqual(unverifiedLaunch);
  expect(f.sdk.launch).not.toHaveBeenCalled();
});

test.each([
  "RUNTIME_NOT_INSTALLED",
  "RUNTIME_FINGERPRINT_UNAVAILABLE",
  "RUNTIME_FINGERPRINT_MODE_UNSUPPORTED",
])("keeps preparation failure %s before spawn", async (failureCode) => {
  const f = fixture();
  f.preparer.prepareStored.mockResolvedValue({
    status: "failed_before_spawn",
    failureCode,
  });
  await expect(f.adapter.launch(input)).resolves.toEqual({
    status: "failed_before_spawn",
    failureCode,
  });
  expect(f.sdk.launch).not.toHaveBeenCalled();
  expect(f.readInventory).not.toHaveBeenCalled();
});

test("redacts an unexpected preparation failure", async () => {
  const f = fixture();
  f.preparer.prepareStored.mockRejectedValue(new Error("private config"));
  await expect(f.adapter.launch(input)).resolves.toEqual({
    status: "failed_before_spawn",
    failureCode: "RUNTIME_PREPARATION_FAILED",
  });
  expect(f.sdk.launch).not.toHaveBeenCalled();
});

test("does not call SDK when the profile already has a process tree", async () => {
  const f = fixture();
  f.readInventory.mockReset().mockResolvedValue(available(present()));
  await expect(f.adapter.launch(input)).resolves.toEqual(unverifiedLaunch);
  expect(f.sdk.launch).not.toHaveBeenCalled();
});

test("does not call SDK with an incomplete pre-launch scan", async () => {
  const f = fixture();
  f.readInventory.mockReset().mockResolvedValue(available(absent()));
  f.readInventory.mockResolvedValueOnce(
    available({ ...absent(), processScanComplete: false }),
  );
  await expect(f.adapter.launch(input)).resolves.toEqual(unverifiedLaunch);
  expect(f.sdk.launch).not.toHaveBeenCalled();
});

test("SDK rejection cannot claim failure before spawn or leak its error", async () => {
  const f = fixture();
  f.sdk.launch.mockRejectedValue(new Error("ws://private-cdp proxy-secret"));
  await expect(f.adapter.launch(input)).resolves.toEqual(unknownLaunch);
  expect(f.sdk.launch).toHaveBeenCalledTimes(1);
  expect(f.readInventory).toHaveBeenCalledTimes(1);
});

test("a throwing inventory reader returns uncertainty without leaking its error", async () => {
  const f = fixture();
  f.readInventory.mockReset().mockRejectedValue(new Error("private command line"));
  await expect(f.adapter.launch(input)).resolves.toEqual({
    status: "spawn_uncertain",
    failureCode: "RUNTIME_PROCESS_SCAN_UNAVAILABLE",
    process: null,
  });
  expect(f.sdk.launch).not.toHaveBeenCalled();
});

test.each([
  ["absent", absent()],
  ["unattributed process", present({ unattributedPotentialProcessCount: 1 })],
  [
    "foreign CDP owner",
    present({
      cdpListeners: [{ localAddress: "127.0.0.1", localPort: 4567, ownerPid: 999 }],
    }),
  ],
  ["unreadable listeners", present({ cdpListeners: null })],
  [
    "public listener",
    present({
      cdpListeners: [{ localAddress: "0.0.0.0", localPort: 4567, ownerPid: 4242 }],
    }),
  ],
  [
    "old process",
    present({
      processes: present().processes.map((process) => ({
        ...process,
        createdAt: "2026-10-04T00:00:00.000Z",
      })),
    }),
  ],
])(
  "keeps an unverified post-spawn snapshot uncertain: %s",
  async (_name, inventory) => {
    const f = fixture();
    f.readInventory
      .mockReset()
      .mockResolvedValueOnce(available(absent()))
      .mockResolvedValueOnce(available(inventory));
    await expect(f.adapter.launch(input)).resolves.toEqual(unverifiedLaunch);
    expect(f.child.listenerCount("exit")).toBe(0);
    expect(f.child.listenerCount("error")).toBe(0);
  },
);

test("does not accept a session for a different profile directory", async () => {
  const f = fixture();
  f.sdk.launch.mockResolvedValue({ ...f.session, userDataDir: "C:\\other-profile" });
  await expect(f.adapter.launch(input)).resolves.toEqual(unverifiedLaunch);
});

test("does not accept disagreement between session PID and child PID", async () => {
  const f = fixture();
  f.sdk.launch.mockResolvedValue({ ...f.session, pid: 9999 });
  await expect(f.adapter.launch(input)).resolves.toEqual(unverifiedLaunch);
});

test("matches equivalent Windows directory spellings", async () => {
  const f = fixture();
  const result = await f.adapter.launch({
    ...input,
    profileDirectory: `c:\\antidetect\\profiles\\temporary\\..\\${profileId}`,
  });
  expect(result.status).toBe("started");
});

test("snapshots caller input and durable timestamp before asynchronous preparation", async () => {
  const f = fixture();
  const wait = deferred<Awaited<ReturnType<ShardXLaunchPreparer["prepareStored"]>>>();
  f.preparer.prepareStored.mockReturnValue(wait.promise);
  const record = run();
  f.runs.findById.mockResolvedValue(record);
  const mutable = { ...input };
  const launching = f.adapter.launch(mutable);
  await vi.waitFor(() => expect(f.preparer.prepareStored).toHaveBeenCalledTimes(1));
  mutable.runId = "changed";
  mutable.profileId = "changed";
  mutable.profileDirectory = "C:\\other";
  Object.assign(record, { createdAt: "2099-01-01T00:00:00.000Z" });
  wait.resolve({ status: "prepared", profile: f.profile, options: f.options });
  const result = await launching;
  expect(result.status).toBe("started");
  expect(f.preparer.prepareStored).toHaveBeenCalledWith(input, f.identities);
});

test("blocks overlapping launch attempts for one profile without blocking another profile", async () => {
  const f = fixture();
  const wait = deferred<typeof f.session>();
  f.sdk.launch.mockReturnValue(wait.promise);
  const launching = f.adapter.launch(input);
  await vi.waitFor(() => expect(f.sdk.launch).toHaveBeenCalledTimes(1));
  await expect(f.adapter.launch(input)).resolves.toEqual(unknownLaunch);
  const another = {
    ...input,
    runId: "d30b059f-0cce-4a5b-b7a8-9aa0c0bcb42a",
    profileId: "f4ace6a0-5049-46af-8b49-797b2216cc2e",
  };
  f.runs.findById.mockResolvedValue(null);
  await expect(f.adapter.launch(another)).resolves.toMatchObject({
    status: "failed_before_spawn",
  });
  expect(f.runs.findById).toHaveBeenCalledWith(another.runId);
  wait.resolve(f.session);
  await launching;
});

test("rejects an already exited SDK child even if its PID is present in a later snapshot", async () => {
  const f = fixture();
  Object.defineProperty(f.child, "exitCode", { value: 0 });
  await expect(f.adapter.launch(input)).resolves.toEqual(unknownLaunch);
  expect(f.child.listenerCount("exit")).toBe(0);
});

test("does not report started when the child exits during identity inspection", async () => {
  const f = fixture();
  const wait = deferred<ReturnType<typeof available>>();
  f.readInventory
    .mockReset()
    .mockResolvedValueOnce(available(absent()))
    .mockReturnValueOnce(wait.promise);
  const launching = f.adapter.launch(input);
  await vi.waitFor(() => expect(f.readInventory).toHaveBeenCalledTimes(2));
  f.child.emit("exit", 0, null);
  wait.resolve(available(present()));
  await expect(launching).resolves.toEqual(unknownLaunch);
});

test("publishes exit only after the whole tree is confirmed absent and replays it to late subscribers", async () => {
  const f = fixture();
  const result = await f.adapter.launch(input);
  if (result.status !== "started") throw new Error("Expected verified launch");
  const first = vi.fn();
  const removed = vi.fn();
  result.process.onExit(first);
  result.process.onExit(removed)();
  f.child.emit("exit", 0, null);
  await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
  expect(first).toHaveBeenCalledWith({ kind: "unknown", code: 0, signal: null });
  expect(removed).not.toHaveBeenCalled();
  const late = vi.fn();
  result.process.onExit(late);
  expect(late).toHaveBeenCalledExactlyOnceWith({
    kind: "unknown",
    code: 0,
    signal: null,
  });
  expect(f.child.listenerCount("exit")).toBe(0);
  expect(f.child.listenerCount("error")).toBe(0);
});

test("rechecks residual children with bounded waits before publishing confirmed exit", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const result = await f.adapter.launch(input);
  if (result.status !== "started") throw new Error("Expected verified launch");
  const residual = present({ processes: present().processes.slice(1) });
  f.readInventory
    .mockResolvedValueOnce(available(residual))
    .mockResolvedValueOnce(available(absent()));
  const onExit = vi.fn();
  result.process.onExit(onExit);
  f.child.emit("exit", 2, null);
  await Promise.resolve();
  expect(onExit).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(onExit).toHaveBeenCalledExactlyOnceWith({
    kind: "abnormal",
    code: 2,
    signal: null,
  });
});

test("never emits exit or polls forever when remaining processes cannot be excluded", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const result = await f.adapter.launch(input);
  if (result.status !== "started") throw new Error("Expected verified launch");
  f.readInventory.mockResolvedValue({
    status: "unavailable",
    failureCode: "RUNTIME_PROCESS_SCAN_UNAVAILABLE",
  });
  const onExit = vi.fn();
  result.process.onExit(onExit);
  f.child.emit("exit", 0, null);
  await vi.runAllTimersAsync();
  expect(onExit).not.toHaveBeenCalled();
  expect(f.readInventory).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.readInventory).toHaveBeenCalledTimes(5);
});

test("default SDK refuses missing assets without install, launch, inventory scan, or profile files", async () => {
  const root = await mkdtemp(join(tmpdir(), "antidetect-launch-negative-"));
  const paths = resolveAppPaths({ env: { ANTIDETECT_HOME: root } });
  const forbidden = () => {
    throw new Error("Forbidden engine operation in test");
  };
  const install = vi.spyOn(Runtime.prototype, "install").mockImplementation(forbidden);
  const launch = vi.spyOn(ShardX.prototype, "launch").mockImplementation(forbidden);
  const readInventory = vi
    .fn<NonNullable<ShardXLaunchAdapterDependencies["readInventory"]>>()
    .mockImplementation(forbidden);
  const runs = {
    findById: vi.fn<BrowserRunRepository["findById"]>().mockResolvedValue(run()),
  };
  const identities = {
    findById: vi.fn<FingerprintIdentityRepository["findById"]>().mockResolvedValue({
      id: identityRef,
      formatVersion: 1,
      config: { navigator: { platform: "Windows" } },
      createdAt: timestamp,
    }),
  };
  try {
    const adapter = new ShardXLaunchAdapter(paths, { runs, identities, readInventory });
    await expect(
      adapter.launch({
        ...input,
        profileDirectory: join(paths.profilesDir, profileId),
      }),
    ).resolves.toEqual({
      status: "failed_before_spawn",
      failureCode: "RUNTIME_NOT_INSTALLED",
    });
    expect(install).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(readInventory).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the pinned SDK appends the profile UUID to the supplied root exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "antidetect-sdk-directory-"));
  const paths = resolveAppPaths({ env: { ANTIDETECT_HOME: root } });
  const sdk = createShardXSdk(paths);
  try {
    const directory = userDataDir(sdk.runtime, profileId, paths.profilesDir);
    expect(directory).toBe(join(paths.profilesDir, profileId));
    expect(await readdir(directory)).toEqual([]);
    expect(await readdir(paths.profilesDir)).toEqual([profileId]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
