import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { win32 } from "node:path";

const unverifiedFailureCode = "RUNTIME_PROCESS_IDENTITY_UNVERIFIED" as const;

export interface ShardXProcessObservation {
  readonly pid: number;
  readonly parentPid: number;
  readonly executablePath: string | null;
  readonly profileDirectory: string | null;
  readonly createdAt: string | null;
}

export interface ShardXCdpListenerObservation {
  readonly localAddress: string;
  readonly localPort: number;
  readonly ownerPid: number;
}

/** Complete, read-only process and listener snapshot gathered by the adapter. */
export interface ShardXProcessInventory {
  readonly processScanComplete: boolean;
  readonly processes: readonly ShardXProcessObservation[];
  /** Chromium processes whose executable/profile association could not be established. */
  readonly unattributedPotentialProcessCount: number;
  /** Whether a launcher that could still create the browser is known to remain. */
  readonly pendingLauncher: "none" | "present" | "unknown";
  /** Port read from this profile's DevToolsActivePort file, if available. */
  readonly cdpPort: number | null;
  /** null means the listener scan failed or was incomplete. */
  readonly cdpListeners: readonly ShardXCdpListenerObservation[] | null;
}

export interface ShardXProcessIdentityExpectation {
  readonly executablePath: string;
  readonly profileDirectory: string;
  readonly runCreatedAt: string;
  readonly processPid: number | null;
  readonly processIdentity: string | null;
}

export interface ShardXProcessIdentityMatched {
  readonly status: "matched";
  /** PID of the unique process-tree root that owns this browser run. */
  readonly pid: number;
  /** Stable digest of the root PID, creation time, executable, and profile path. */
  readonly processIdentity: string;
  readonly processTreePids: readonly number[];
}

export interface ShardXProcessIdentityAbsent {
  readonly status: "absent";
}

export interface ShardXProcessIdentityUnknown {
  readonly status: "unknown";
  readonly failureCode: typeof unverifiedFailureCode;
}

export type ShardXProcessIdentityResult =
  | ShardXProcessIdentityMatched
  | ShardXProcessIdentityAbsent
  | ShardXProcessIdentityUnknown;

function unknown(): ShardXProcessIdentityUnknown {
  return { status: "unknown", failureCode: unverifiedFailureCode };
}

function normalizeWindowsPath(value: string): string | null {
  const input = value.trim();
  if (!win32.isAbsolute(input)) return null;

  const normalized = win32.normalize(input);
  const root = win32.parse(normalized).root;
  const withoutTrailingSeparators =
    normalized.length > root.length ? normalized.replace(/[\\/]+$/, "") : normalized;
  return withoutTrailingSeparators.toLowerCase();
}

function parseUtcTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?Z$/.exec(value);
  if (match === null) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 19) !== match[1]
  ) {
    return null;
  }

  return `${match[1]}.${(match[2] ?? "").padEnd(7, "0")}Z`;
}

function isLoopbackAddress(value: string): boolean {
  const address = value.trim().toLowerCase();
  if (isIP(address) === 4) return address.startsWith("127.");
  if (address === "::1") return true;

  const mappedIpv4Prefix = "::ffff:";
  if (address.startsWith(mappedIpv4Prefix)) {
    const mappedAddress = address.slice(mappedIpv4Prefix.length);
    return isIP(mappedAddress) === 4 && mappedAddress.startsWith("127.");
  }

  return false;
}

function createIdentityDigest(
  root: ShardXProcessObservation,
  createdAt: string,
  executablePath: string,
  profileDirectory: string,
): string {
  const identity = [String(root.pid), createdAt, executablePath, profileDirectory].join(
    "\0",
  );
  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  return `shardx-process-v1:${digest}`;
}

/**
 * Reconciles one persisted browser run against a complete Windows process snapshot.
 * Any missing or conflicting evidence fails closed as `unknown`; it never stops a process.
 */
export function identifyShardXProcess(
  expected: ShardXProcessIdentityExpectation,
  inventory: ShardXProcessInventory,
): ShardXProcessIdentityResult {
  const expectedExecutablePath = normalizeWindowsPath(expected.executablePath);
  const expectedProfileDirectory = normalizeWindowsPath(expected.profileDirectory);
  const runCreatedAt = parseUtcTimestamp(expected.runCreatedAt);
  if (
    expectedExecutablePath === null ||
    expectedProfileDirectory === null ||
    runCreatedAt === null ||
    (expected.processPid !== null &&
      (!Number.isSafeInteger(expected.processPid) || expected.processPid <= 0)) ||
    !Number.isSafeInteger(inventory.unattributedPotentialProcessCount) ||
    inventory.unattributedPotentialProcessCount < 0
  ) {
    return unknown();
  }

  if (!inventory.processScanComplete || inventory.pendingLauncher !== "none") {
    return unknown();
  }

  const matchingProfileProcesses: ShardXProcessObservation[] = [];
  for (const process of inventory.processes) {
    const executablePath =
      process.executablePath === null
        ? null
        : normalizeWindowsPath(process.executablePath);
    const profileDirectory =
      process.profileDirectory === null
        ? null
        : normalizeWindowsPath(process.profileDirectory);

    if (profileDirectory === expectedProfileDirectory) {
      if (
        executablePath !== expectedExecutablePath ||
        !Number.isSafeInteger(process.pid) ||
        process.pid <= 0 ||
        !Number.isSafeInteger(process.parentPid) ||
        process.parentPid < 0 ||
        process.createdAt === null
      ) {
        return unknown();
      }

      const createdAt = parseUtcTimestamp(process.createdAt);
      if (createdAt === null || createdAt < runCreatedAt) return unknown();
      matchingProfileProcesses.push(process);
      continue;
    }

    // A ShardX browser with unreadable profile arguments could be this run.
    if (
      executablePath === expectedExecutablePath &&
      (process.profileDirectory === null || profileDirectory === null)
    ) {
      return unknown();
    }
  }

  if (inventory.unattributedPotentialProcessCount > 0) return unknown();
  if (matchingProfileProcesses.length === 0) {
    if (inventory.cdpPort !== null && inventory.cdpListeners === null) return unknown();
    if (
      inventory.cdpPort !== null &&
      inventory.cdpListeners?.some(
        (listener) => listener.localPort === inventory.cdpPort,
      )
    ) {
      return unknown();
    }
    return { status: "absent" };
  }

  if (
    !Number.isSafeInteger(inventory.cdpPort) ||
    inventory.cdpPort === null ||
    inventory.cdpPort < 1 ||
    inventory.cdpPort > 65535 ||
    inventory.cdpListeners === null
  ) {
    return unknown();
  }

  const processByPid = new Map<number, ShardXProcessObservation>();
  for (const process of matchingProfileProcesses) {
    if (processByPid.has(process.pid)) return unknown();
    processByPid.set(process.pid, process);
  }

  const roots = matchingProfileProcesses.filter(
    (process) => !processByPid.has(process.parentPid),
  );
  if (roots.length !== 1) return unknown();
  const root = roots[0];
  if (root === undefined) return unknown();

  const processTreePids = new Set<number>();
  const pendingPids = [root.pid];
  while (pendingPids.length > 0) {
    const parentPid = pendingPids.shift();
    if (parentPid === undefined) return unknown();
    if (processTreePids.has(parentPid)) continue;
    processTreePids.add(parentPid);
    for (const child of matchingProfileProcesses) {
      if (child.parentPid === parentPid) pendingPids.push(child.pid);
    }
  }

  if (processTreePids.size !== matchingProfileProcesses.length) return unknown();

  const matchingListeners = inventory.cdpListeners.filter(
    (listener) => listener.localPort === inventory.cdpPort,
  );
  if (
    matchingListeners.length === 0 ||
    matchingListeners.some(
      (listener) =>
        !Number.isSafeInteger(listener.ownerPid) ||
        listener.ownerPid <= 0 ||
        !isLoopbackAddress(listener.localAddress),
    )
  ) {
    return unknown();
  }

  const listenerOwnerPids = new Set(
    matchingListeners.map((listener) => listener.ownerPid),
  );
  if (listenerOwnerPids.size !== 1) return unknown();
  const listenerOwnerPid = matchingListeners[0]?.ownerPid;
  if (listenerOwnerPid === undefined || !processTreePids.has(listenerOwnerPid)) {
    return unknown();
  }

  if (expected.processPid !== null && root.pid !== expected.processPid)
    return unknown();

  const rootCreatedAt = root.createdAt;
  if (rootCreatedAt === null) return unknown();
  const rootCreatedAtTimestamp = parseUtcTimestamp(rootCreatedAt);
  if (rootCreatedAtTimestamp === null) return unknown();
  const processIdentity = createIdentityDigest(
    root,
    rootCreatedAtTimestamp,
    expectedExecutablePath,
    expectedProfileDirectory,
  );
  if (
    expected.processIdentity !== null &&
    expected.processIdentity !== processIdentity
  ) {
    return unknown();
  }

  return {
    status: "matched",
    pid: root.pid,
    processIdentity,
    processTreePids: [...processTreePids].sort((left, right) => left - right),
  };
}
