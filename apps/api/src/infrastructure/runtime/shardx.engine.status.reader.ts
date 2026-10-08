import type { Stats } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import {
  engineStatusResponseSchema,
  type EngineStatus,
  type EngineStatusResponse,
} from "@antidetect/contracts";
import { EngineStatusReader } from "../../application/runtime/engine.status.reader.js";

const MAX_METADATA_BYTES = 64 * 1024;

async function statIfPresent(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function hasEntry(path: string, fingerprintOnly = false): Promise<boolean> {
  const directory = await opendir(path);
  for await (const entry of directory) {
    if (!fingerprintOnly || (entry.isFile() && entry.name.endsWith(".json"))) {
      return true;
    }
  }
  return false;
}

async function hasWindowsExecutableHeader(path: string): Promise<boolean> {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(2);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    return bytesRead === 2 && header.toString("ascii") === "MZ";
  } finally {
    await file.close();
  }
}

async function readVersion(path: string): Promise<string | null> {
  const file = await open(path, "r");
  try {
    const metadata = Buffer.alloc(MAX_METADATA_BYTES + 1);
    const { bytesRead } = await file.read(metadata, 0, metadata.length, 0);
    if (bytesRead > MAX_METADATA_BYTES) return null;

    let value: unknown;
    try {
      value = JSON.parse(metadata.subarray(0, bytesRead).toString("utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const version = (value as Record<string, unknown>).installed_chromium_version;
    const parsed = engineStatusResponseSchema.shape.version.safeParse(version);
    return parsed.success ? parsed.data : null;
  } finally {
    await file.close();
  }
}

// Detect local assets only. This does not prove SDK readiness, integrity, or a successful launch.
export class ShardXEngineStatusReader extends EngineStatusReader {
  constructor(
    private readonly runtimeDirectory: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    super();
  }

  async read(): Promise<EngineStatusResponse> {
    const result = (
      status: EngineStatus,
      version: string | null = null,
    ): EngineStatusResponse => ({ engine: "shardx", status, version });

    if (this.platform !== "win32") return result("unavailable");

    try {
      const root = await statIfPresent(this.runtimeDirectory);
      if (root === undefined) return result("not_installed");
      if (!root.isDirectory()) return result("unavailable");
      if (
        await statIfPresent(join(this.runtimeDirectory, ".runtime-update-recovery"))
      ) {
        return result("recovery_required");
      }
      if (!(await hasEntry(this.runtimeDirectory))) return result("not_installed");

      const engineDirectory = join(this.runtimeDirectory, "ShardX-Windows");
      const binaryPath = join(engineDirectory, "chrome.exe");
      const fingerprintsDirectory = join(this.runtimeDirectory, "fingerprints");
      const widevineDirectory = join(engineDirectory, "WidevineCdm");
      const metadataPath = join(this.runtimeDirectory, "manifest.json");
      const [engine, binary, fingerprints, widevine, metadata] = await Promise.all([
        statIfPresent(engineDirectory),
        statIfPresent(binaryPath),
        statIfPresent(fingerprintsDirectory),
        statIfPresent(widevineDirectory),
        statIfPresent(metadataPath),
      ]);
      if (
        !engine?.isDirectory() ||
        !binary?.isFile() ||
        !fingerprints?.isDirectory() ||
        !widevine?.isDirectory() ||
        !metadata?.isFile()
      ) {
        return result("incomplete");
      }
      const version = await readVersion(metadataPath);
      if (
        version === null ||
        !(await hasWindowsExecutableHeader(binaryPath)) ||
        !(await hasEntry(fingerprintsDirectory, true)) ||
        !(await hasEntry(widevineDirectory))
      ) {
        return result("incomplete");
      }
      return result("files_detected", version);
    } catch {
      // Filesystem errors and changing caches are not evidence of absence.
      return result("unavailable");
    }
  }
}
