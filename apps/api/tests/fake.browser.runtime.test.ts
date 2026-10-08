import { describe, expect, test } from "vitest";
import {
  FakeBrowserProcessHost,
  FakeBrowserRuntime,
} from "../src/infrastructure/runtime/fake.browser.runtime.ts";

const input = {
  runId: "run-001",
  profileId: "profile-001",
  profileDirectory: "C:/profiles/profile-001",
  identityRef: "identity-001",
} as const;
const runCreatedAt = "2026-09-22T10:00:00.000Z";

describe("FakeBrowserRuntime", () => {
  test("launches a deterministic process and emits a stop exit", async () => {
    const runtime = new FakeBrowserRuntime({ firstPid: 4000 });
    const exits: unknown[] = [];

    const launch = await runtime.launch(input);
    expect(launch.status).toBe("started");
    if (launch.status !== "started") {
      throw new Error("Expected fake launch to start");
    }
    const process = launch.process;
    const unsubscribe = process.onExit((exit) => exits.push(exit));

    expect(process).toMatchObject({
      runtimeId: "run-001:fake-process-001",
      pid: 4000,
      processIdentity: "profile-001:run-001:fake-process-001",
    });
    expect(runtime.launchCalls).toEqual([input]);
    expect(runtime.activeProcesses()).toEqual([process]);

    await expect(runtime.stop(process, { timeoutMs: 5000 })).resolves.toEqual({
      status: "stopped",
      exit: { kind: "normal", code: 0, signal: null },
    });
    expect(exits).toEqual([{ kind: "normal", code: 0, signal: null }]);
    expect(runtime.activeProcesses()).toEqual([]);
    unsubscribe();
  });

  test("accepts a launch without a fingerprint identity", async () => {
    const runtime = new FakeBrowserRuntime();

    await expect(
      runtime.launch({ ...input, identityRef: null }),
    ).resolves.toMatchObject({
      status: "started",
    });
    expect(runtime.launchCalls).toMatchObject([{ identityRef: null }]);
  });

  test("models a launch failure before spawn without leaving a process", async () => {
    const runtime = new FakeBrowserRuntime({
      launchPlans: [{ outcome: "fail-before-spawn", failureCode: "LAUNCH_FAILED" }],
    });

    await expect(runtime.launch(input)).resolves.toEqual({
      status: "failed_before_spawn",
      failureCode: "LAUNCH_FAILED",
    });
    expect(runtime.activeProcesses()).toEqual([]);
  });

  test("models a launch failure after spawn and exposes the orphaned process", async () => {
    const runtime = new FakeBrowserRuntime({
      launchPlans: [
        { outcome: "fail-after-spawn", failureCode: "LAUNCH_STATE_UNKNOWN" },
      ],
    });

    const result = await runtime.launch(input);
    expect(result).toMatchObject({
      status: "spawn_uncertain",
      failureCode: "LAUNCH_STATE_UNKNOWN",
    });
    expect(runtime.activeProcesses()).toHaveLength(1);
    expect(runtime.activeProcesses()[0]).toMatchObject({
      processIdentity: "profile-001:run-001:fake-process-001",
    });
  });

  test("keeps a process active for timeout and stop failure", async () => {
    const runtime = new FakeBrowserRuntime({
      stopPlans: [
        { outcome: "timeout" },
        { outcome: "fail", failureCode: "STOP_FAILED" },
        { outcome: "success", exit: { kind: "normal", code: 0, signal: null } },
      ],
    });
    const launch = await runtime.launch(input);
    if (launch.status !== "started") {
      throw new Error("Expected fake launch to start");
    }
    const process = launch.process;

    await expect(runtime.stop(process, { timeoutMs: 100 })).resolves.toEqual({
      status: "timed_out",
      failureCode: "RUNTIME_STOP_TIMEOUT",
      exit: null,
    });
    expect(runtime.activeProcesses()).toEqual([process]);

    await expect(runtime.stop(process, { timeoutMs: 100 })).resolves.toEqual({
      status: "failed",
      failureCode: "STOP_FAILED",
      exit: null,
    });
    expect(runtime.activeProcesses()).toEqual([process]);

    await expect(runtime.stop(process, { timeoutMs: 100 })).resolves.toMatchObject({
      status: "stopped",
    });
    expect(runtime.activeProcesses()).toEqual([]);
  });

  test("notifies listeners about an unexpected exit and makes repeated stop safe", async () => {
    const runtime = new FakeBrowserRuntime();
    const launch = await runtime.launch(input);
    if (launch.status !== "started") {
      throw new Error("Expected fake launch to start");
    }
    const process = launch.process;
    const exits: unknown[] = [];
    process.onExit((exit) => exits.push(exit));

    runtime.emitUnexpectedExit(process, { code: 17, signal: "SIGTERM" });

    expect(exits).toEqual([{ kind: "abnormal", code: 17, signal: "SIGTERM" }]);
    await expect(runtime.stop(process, { timeoutMs: 100 })).resolves.toEqual({
      status: "stopped",
      exit: { kind: "abnormal", code: 17, signal: "SIGTERM" },
    });
  });

  test.each([
    { method: "emitNormalExit", kind: "normal" },
    { method: "emitUnexpectedExit", kind: "abnormal" },
    { method: "emitUnknownExit", kind: "unknown" },
  ] as const)(
    "preserves $kind classification across notifications, stop, and recovery",
    async ({ method, kind }) => {
      const runtime = new FakeBrowserRuntime();
      const launch = await runtime.launch(input);
      if (launch.status !== "started") throw new Error("Expected fake launch to start");
      const process = launch.process;
      const exits: unknown[] = [];
      process.onExit((exit) => exits.push(exit));

      runtime[method](process, { code: 0, signal: null });
      runtime[method](process, { code: 19, signal: "SIGTERM" });
      const exit = { kind, code: 0, signal: null };
      expect(exits).toEqual([exit]);
      expect(runtime.activeProcesses()).toEqual([]);
      await expect(runtime.stop(process, { timeoutMs: 100 })).resolves.toEqual({
        status: "stopped",
        exit,
      });
      await expect(
        runtime.recover({
          ...input,
          runCreatedAt,
          processPid: process.pid,
          processIdentity: process.processIdentity,
        }),
      ).resolves.toEqual({ status: "exited", exit });
    },
  );

  test("reattaches after the API owner exits and resumes exit notifications", async () => {
    const processHost = new FakeBrowserProcessHost();
    const firstRuntime = new FakeBrowserRuntime({ processHost, firstPid: 4100 });
    const launch = await firstRuntime.launch(input);
    if (launch.status !== "started") {
      throw new Error("Expected fake launch to start");
    }
    processHost.simulateApiProcessExit();

    const restartedRuntime = new FakeBrowserRuntime({ processHost });
    const recovery = await restartedRuntime.recover({
      runId: input.runId,
      profileId: input.profileId,
      runCreatedAt,
      profileDirectory: input.profileDirectory,
      processPid: launch.process.pid ?? 0,
      processIdentity: launch.process.processIdentity,
    });
    expect(recovery.status).toBe("attached");
    if (recovery.status !== "attached") {
      throw new Error("Expected fake process to be reattached");
    }

    const exits: unknown[] = [];
    recovery.process.onExit((exit) => exits.push(exit));
    restartedRuntime.emitUnexpectedExit(recovery.process, { code: 19, signal: null });

    expect(exits).toEqual([{ kind: "abnormal", code: 19, signal: null }]);
    expect(restartedRuntime.recoveryCalls).toEqual([
      {
        runId: input.runId,
        profileId: input.profileId,
        runCreatedAt,
        profileDirectory: input.profileDirectory,
        processPid: 4100,
        processIdentity: "profile-001:run-001:fake-process-001",
      },
    ]);
  });

  test("finds a spawned process by run id when PID metadata was not persisted", async () => {
    const processHost = new FakeBrowserProcessHost();
    const firstRuntime = new FakeBrowserRuntime({ processHost, firstPid: 4200 });
    const launch = await firstRuntime.launch(input);
    expect(launch.status).toBe("started");
    processHost.simulateApiProcessExit();

    const restartedRuntime = new FakeBrowserRuntime({ processHost });
    await expect(
      restartedRuntime.recover({
        runId: input.runId,
        profileId: input.profileId,
        runCreatedAt,
        profileDirectory: input.profileDirectory,
        processPid: null,
        processIdentity: null,
      }),
    ).resolves.toMatchObject({ status: "attached" });
    expect(restartedRuntime.recoveryCalls).toEqual([
      {
        runId: input.runId,
        profileId: input.profileId,
        runCreatedAt,
        profileDirectory: input.profileDirectory,
        processPid: null,
        processIdentity: null,
      },
    ]);
  });

  test("does not reattach when the profile directory does not match", async () => {
    const processHost = new FakeBrowserProcessHost();
    const firstRuntime = new FakeBrowserRuntime({ processHost });
    const launch = await firstRuntime.launch(input);
    if (launch.status !== "started") {
      throw new Error("Expected fake launch to start");
    }
    processHost.simulateApiProcessExit();

    const restartedRuntime = new FakeBrowserRuntime({ processHost });
    await expect(
      restartedRuntime.recover({
        runId: input.runId,
        profileId: input.profileId,
        runCreatedAt,
        profileDirectory: "C:/profiles/another-profile",
        processPid: launch.process.pid,
        processIdentity: launch.process.processIdentity,
      }),
    ).resolves.toEqual({
      status: "unknown",
      failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
    });
  });

  test("does not reattach when the persisted process identity does not match", async () => {
    const processHost = new FakeBrowserProcessHost();
    const firstRuntime = new FakeBrowserRuntime({ processHost });
    const launch = await firstRuntime.launch(input);
    if (launch.status !== "started") {
      throw new Error("Expected fake launch to start");
    }

    const restartedRuntime = new FakeBrowserRuntime({ processHost });
    await expect(
      restartedRuntime.recover({
        runId: input.runId,
        profileId: input.profileId,
        runCreatedAt,
        profileDirectory: input.profileDirectory,
        processPid: launch.process.pid ?? 0,
        processIdentity: "another-process-identity",
      }),
    ).resolves.toEqual({
      status: "unknown",
      failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
    });
  });

  test("rejects empty launch input", async () => {
    const runtime = new FakeBrowserRuntime();

    await expect(runtime.launch({ ...input, profileId: " " })).rejects.toThrow(
      "profileId must not be empty",
    );
  });
});
