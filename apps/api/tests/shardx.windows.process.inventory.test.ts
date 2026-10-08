import { describe, expect, test } from "vitest";
import {
  parseShardXWindowsProcessSnapshot,
  readShardXWindowsProcessInventory,
  type ShardXWindowsProcessInventoryRequest,
} from "../src/infrastructure/runtime/shardx.windows.process.inventory.ts";

const request: ShardXWindowsProcessInventoryRequest = {
  executablePath: "C:\\ShardX\\runtime-cache\\chrome.exe",
  profileDirectory: "C:\\AppData\\profiles\\profile-001",
  pendingLauncher: "none",
};

const completeSnapshot = {
  processScanComplete: true,
  processes: [
    {
      pid: 100,
      parentPid: 50,
      executablePath: "C:\\ShardX\\runtime-cache\\chrome.exe",
      profileDirectory: "C:\\AppData\\profiles\\profile-001",
      createdAt: "2026-10-03T10:00:01.0000000Z",
    },
    {
      pid: 101,
      parentPid: 100,
      executablePath: "C:\\ShardX\\runtime-cache\\chrome.exe",
      profileDirectory: "C:\\AppData\\profiles\\profile-001",
      createdAt: "2026-10-03T10:00:01.1000000Z",
    },
  ],
  unattributedPotentialProcessCount: 0,
  cdpPort: 9222,
  cdpListeners: [{ localAddress: "127.0.0.1", localPort: 9222, ownerPid: 100 }],
};

describe("readShardXWindowsProcessInventory", () => {
  test("parses a complete snapshot and carries explicit launcher evidence", async () => {
    const result = await readShardXWindowsProcessInventory(
      { ...request, pendingLauncher: "unknown" },
      async () => JSON.stringify(completeSnapshot),
    );

    expect(result).toEqual({
      status: "available",
      inventory: {
        ...completeSnapshot,
        pendingLauncher: "unknown",
      },
    });
  });

  test("does not interpolate filesystem paths as PowerShell code", async () => {
    let script = "";
    await readShardXWindowsProcessInventory(request, async (value) => {
      script = value;
      return JSON.stringify(completeSnapshot);
    });

    expect(script).toContain("Get-CimInstance -ClassName Win32_Process");
    expect(script).toContain("Get-NetTCPConnection -State Listen");
    expect(script).not.toContain(request.executablePath);
    expect(script).not.toContain(request.profileDirectory);
    expect(script).not.toContain("Write-Host");
  });

  test("fails closed when the Windows scan reports incomplete", () => {
    expect(
      parseShardXWindowsProcessSnapshot(
        JSON.stringify({ ...completeSnapshot, processScanComplete: false }),
        "none",
      ),
    ).toEqual({
      status: "unavailable",
      failureCode: "RUNTIME_PROCESS_SCAN_UNAVAILABLE",
    });
  });

  test.each([
    ["malformed JSON", "{"],
    ["invalid process row", JSON.stringify({ ...completeSnapshot, processes: [null] })],
    [
      "invalid listener row",
      JSON.stringify({ ...completeSnapshot, cdpListeners: [{}] }),
    ],
    ["invalid listener port", JSON.stringify({ ...completeSnapshot, cdpPort: 70000 })],
  ])("fails closed for %s", (_name, output) => {
    expect(parseShardXWindowsProcessSnapshot(output, "none")).toMatchObject({
      status: "unavailable",
      failureCode: "RUNTIME_PROCESS_SCAN_UNAVAILABLE",
    });
  });

  test("fails closed when the PowerShell query fails", async () => {
    await expect(
      readShardXWindowsProcessInventory(request, async () => {
        throw new Error("private OS error must not leak");
      }),
    ).resolves.toEqual({
      status: "unavailable",
      failureCode: "RUNTIME_PROCESS_SCAN_UNAVAILABLE",
    });
  });

  test("rejects relative paths without invoking the process scanner", async () => {
    let invoked = false;
    const result = await readShardXWindowsProcessInventory(
      { ...request, profileDirectory: "profile-001" },
      async () => {
        invoked = true;
        return JSON.stringify(completeSnapshot);
      },
    );

    expect(invoked).toBe(false);
    expect(result).toEqual({
      status: "unavailable",
      failureCode: "RUNTIME_PROCESS_SCAN_UNAVAILABLE",
    });
  });
});
