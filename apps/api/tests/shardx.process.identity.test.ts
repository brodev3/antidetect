import { describe, expect, test } from "vitest";
import {
  identifyShardXProcess,
  type ShardXCdpListenerObservation,
  type ShardXProcessIdentityExpectation,
  type ShardXProcessInventory,
  type ShardXProcessObservation,
} from "../src/infrastructure/runtime/shardx.process.identity.ts";

const executablePath = "C:\\ShardX\\runtime-cache\\chrome.exe";
const profileDirectory = "C:\\AppData\\profiles\\profile-001";
const runCreatedAt = "2026-10-03T10:00:00.000Z";

function expected(
  overrides: Partial<ShardXProcessIdentityExpectation> = {},
): ShardXProcessIdentityExpectation {
  return {
    executablePath,
    profileDirectory,
    runCreatedAt,
    processPid: null,
    processIdentity: null,
    ...overrides,
  };
}

function processObservation(
  pid: number,
  parentPid: number,
  overrides: Partial<ShardXProcessObservation> = {},
): ShardXProcessObservation {
  return {
    pid,
    parentPid,
    executablePath,
    profileDirectory,
    createdAt: "2026-10-03T10:00:01.000Z",
    ...overrides,
  };
}

function listener(
  overrides: Partial<ShardXCdpListenerObservation> = {},
): ShardXCdpListenerObservation {
  return {
    localAddress: "127.0.0.1",
    localPort: 9222,
    ownerPid: 100,
    ...overrides,
  };
}

function inventory(
  overrides: Partial<ShardXProcessInventory> = {},
): ShardXProcessInventory {
  return {
    processScanComplete: true,
    processes: [processObservation(100, 50), processObservation(101, 100)],
    unattributedPotentialProcessCount: 0,
    pendingLauncher: "none",
    cdpPort: 9222,
    cdpListeners: [listener()],
    ...overrides,
  };
}

describe("identifyShardXProcess", () => {
  test("matches one exact profile tree and binds loopback CDP to that tree", () => {
    const result = identifyShardXProcess(expected(), inventory());

    expect(result).toMatchObject({
      status: "matched",
      pid: 100,
      processTreePids: [100, 101],
    });
    if (result.status !== "matched") throw new Error("Expected a verified process");
    expect(result.processIdentity).toMatch(/^shardx-process-v1:[a-f0-9]{64}$/);
    expect(result.processIdentity).not.toContain(profileDirectory);
    expect(result.processIdentity).not.toContain(executablePath);
  });

  test("matches normalized case and trailing separators for Windows paths", () => {
    const result = identifyShardXProcess(
      expected({
        executablePath: "c:/shardx/runtime-cache/CHROME.exe",
        profileDirectory: "c:/appdata/profiles/profile-001/",
      }),
      inventory(),
    );

    expect(result.status).toBe("matched");
  });

  test("creates the same opaque identity when a saved PID is revalidated", () => {
    const first = identifyShardXProcess(expected(), inventory());
    if (first.status !== "matched") throw new Error("Expected a verified process");

    expect(
      identifyShardXProcess(
        expected({ processPid: first.pid, processIdentity: first.processIdentity }),
        inventory(),
      ),
    ).toEqual(first);
  });

  test("preserves sub-millisecond process creation time in the identity", () => {
    const first = identifyShardXProcess(
      expected(),
      inventory({
        processes: [
          processObservation(100, 50, {
            createdAt: "2026-10-03T10:00:01.0000001Z",
          }),
          processObservation(101, 100, {
            createdAt: "2026-10-03T10:00:01.0000002Z",
          }),
        ],
      }),
    );
    const second = identifyShardXProcess(
      expected(),
      inventory({
        processes: [
          processObservation(100, 50, {
            createdAt: "2026-10-03T10:00:01.0000003Z",
          }),
          processObservation(101, 100, {
            createdAt: "2026-10-03T10:00:01.0000004Z",
          }),
        ],
      }),
    );

    expect(first.status).toBe("matched");
    expect(second.status).toBe("matched");
    if (first.status !== "matched" || second.status !== "matched") {
      throw new Error("Expected verified processes");
    }
    expect(first.processIdentity).not.toBe(second.processIdentity);
  });

  test("returns absent only after a complete scan with no candidate or pending launcher", () => {
    expect(
      identifyShardXProcess(
        expected(),
        inventory({ processes: [], cdpPort: null, cdpListeners: null }),
      ),
    ).toEqual({ status: "absent" });
  });

  test.each([
    {
      name: "incomplete process scan",
      overrides: { processScanComplete: false },
    },
    {
      name: "pending launcher",
      overrides: { pendingLauncher: "present" as const },
    },
    {
      name: "unknown launcher state",
      overrides: { pendingLauncher: "unknown" as const },
    },
    {
      name: "unattributed Chromium process",
      overrides: { processes: [], unattributedPotentialProcessCount: 1 },
    },
    {
      name: "listener without a process candidate",
      overrides: {
        processes: [],
        cdpPort: 9222,
        cdpListeners: [listener()],
      },
    },
  ])("does not declare absent for $name", ({ overrides }) => {
    expect(
      identifyShardXProcess(
        expected(),
        inventory({
          processes: [],
          cdpPort: null,
          cdpListeners: null,
          ...overrides,
        }),
      ),
    ).toMatchObject({
      status: "unknown",
      failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
    });
  });

  test.each([
    {
      name: "different executable",
      processes: [
        processObservation(100, 50, { executablePath: "C:\\Other\\chrome.exe" }),
      ],
    },
    {
      name: "different profile directory",
      processes: [
        processObservation(100, 50, {
          profileDirectory: "C:\\AppData\\profiles\\profile-002",
        }),
      ],
    },
    {
      name: "process created before this run",
      processes: [
        processObservation(100, 50, { createdAt: "2026-10-03T09:59:59.999Z" }),
      ],
    },
    {
      name: "missing creation time",
      processes: [processObservation(100, 50, { createdAt: null })],
    },
  ])("returns unknown for $name", ({ processes }) => {
    expect(identifyShardXProcess(expected(), inventory({ processes }))).toMatchObject({
      status: "unknown",
      failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
    });
  });

  test.each([
    {
      name: "multiple roots",
      processes: [processObservation(100, 50), processObservation(200, 51)],
      cdpListeners: [listener({ ownerPid: 100 })],
    },
    {
      name: "disconnected tree member",
      processes: [processObservation(100, 50), processObservation(200, 999)],
      cdpListeners: [listener({ ownerPid: 100 })],
    },
    {
      name: "CDP owner outside the process tree",
      processes: [processObservation(100, 50), processObservation(101, 100)],
      cdpListeners: [listener({ ownerPid: 999 })],
    },
    {
      name: "non-loopback CDP listener",
      processes: [processObservation(100, 50), processObservation(101, 100)],
      cdpListeners: [listener({ localAddress: "192.168.1.10" })],
    },
  ])("returns unknown for $name", ({ processes, cdpListeners }) => {
    expect(
      identifyShardXProcess(expected(), inventory({ processes, cdpListeners })),
    ).toMatchObject({
      status: "unknown",
      failureCode: "RUNTIME_PROCESS_IDENTITY_UNVERIFIED",
    });
  });

  test("returns unknown when a saved PID or identity differs", () => {
    const first = identifyShardXProcess(expected(), inventory());
    if (first.status !== "matched") throw new Error("Expected a verified process");

    expect(
      identifyShardXProcess(expected({ processPid: 999 }), inventory()),
    ).toMatchObject({ status: "unknown" });
    expect(
      identifyShardXProcess(
        expected({ processIdentity: "shardx-process-v1:stale" }),
        inventory(),
      ),
    ).toMatchObject({ status: "unknown" });
  });

  test("returns unknown when the CDP owner is ambiguous or listener scan failed", () => {
    expect(
      identifyShardXProcess(
        expected(),
        inventory({ cdpListeners: [listener(), listener({ ownerPid: 101 })] }),
      ),
    ).toMatchObject({ status: "unknown" });
    expect(
      identifyShardXProcess(expected(), inventory({ cdpListeners: null })),
    ).toMatchObject({ status: "unknown" });
  });

  test("does not match a profile while another Chromium process is unattributed", () => {
    expect(
      identifyShardXProcess(
        expected(),
        inventory({ unattributedPotentialProcessCount: 1 }),
      ),
    ).toMatchObject({ status: "unknown" });
  });

  test("rejects invalid expectation paths and timestamps", () => {
    expect(
      identifyShardXProcess(expected({ profileDirectory: "profile-001" }), inventory()),
    ).toMatchObject({ status: "unknown" });
    expect(
      identifyShardXProcess(expected({ runCreatedAt: "not-a-timestamp" }), inventory()),
    ).toMatchObject({ status: "unknown" });
    expect(
      identifyShardXProcess(
        expected({ runCreatedAt: "2026-02-30T10:00:00.000Z" }),
        inventory(),
      ),
    ).toMatchObject({ status: "unknown" });
  });
});
