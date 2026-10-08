import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ShardXEngineStatusReader } from "../src/infrastructure/runtime/shardx.engine.status.reader.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{ root: string; reader: ShardXEngineStatusReader }> {
  const root = await mkdtemp(join(tmpdir(), "antidetect-engine-status-"));
  temporaryRoots.push(root);
  return { root, reader: new ShardXEngineStatusReader(join(root, "runtime"), "win32") };
}

async function createAssets(root: string): Promise<void> {
  const runtime = join(root, "runtime");
  await mkdir(join(runtime, "ShardX-Windows", "WidevineCdm"), { recursive: true });
  await mkdir(join(runtime, "fingerprints"));
  await writeFile(
    join(runtime, "ShardX-Windows", "chrome.exe"),
    "MZsynthetic-fixture-not-an-executable",
  );
  await writeFile(
    join(runtime, "ShardX-Windows", "WidevineCdm", "fixture.txt"),
    "synthetic",
  );
  await writeFile(join(runtime, "fingerprints", "fixture.json"), "{}");
  await writeFile(
    join(runtime, "manifest.json"),
    JSON.stringify({ installed_chromium_version: "152.0.7977.65" }),
  );
}

test("missing and empty caches remain not installed without creating files", async () => {
  const { root, reader } = await fixture();
  await expect(reader.read()).resolves.toEqual({
    engine: "shardx",
    status: "not_installed",
    version: null,
  });
  expect(await readdir(root)).toEqual([]);
  await mkdir(join(root, "runtime"));
  await expect(reader.read()).resolves.toMatchObject({ status: "not_installed" });
  expect(await readdir(join(root, "runtime"))).toEqual([]);
});

test("reports local assets and metadata version without claiming readiness", async () => {
  const { root, reader } = await fixture();
  await createAssets(root);
  const metadata = join(root, "runtime", "manifest.json");
  const before = await readFile(metadata);
  await expect(reader.read()).resolves.toEqual({
    engine: "shardx",
    status: "files_detected",
    version: "152.0.7977.65",
  });
  expect(await readFile(metadata)).toEqual(before);
});

test.each([
  "ShardX-Windows/chrome.exe",
  "ShardX-Windows/WidevineCdm/fixture.txt",
  "fingerprints/fixture.json",
  "manifest.json",
])("missing %s is incomplete, not installed or ready", async (asset) => {
  const { root, reader } = await fixture();
  await createAssets(root);
  await rm(join(root, "runtime", asset));
  await expect(reader.read()).resolves.toMatchObject({
    status: "incomplete",
    version: null,
  });
});

test.each([
  "not-json",
  "{}",
  '{"installed_chromium_version":"https://private.invalid/token"}',
  "x".repeat(65537),
])("rejects invalid or oversized metadata without exposing it", async (metadata) => {
  const { root, reader } = await fixture();
  await createAssets(root);
  await writeFile(join(root, "runtime", "manifest.json"), metadata);
  await expect(reader.read()).resolves.toEqual({
    engine: "shardx",
    status: "incomplete",
    version: null,
  });
});

test("invalid executable header is incomplete", async () => {
  const { root, reader } = await fixture();
  await createAssets(root);
  await writeFile(join(root, "runtime", "ShardX-Windows", "chrome.exe"), "invalid");
  await expect(reader.read()).resolves.toMatchObject({ status: "incomplete" });
});

test("unfinished update marker takes precedence over otherwise detected files", async () => {
  const { root, reader } = await fixture();
  await createAssets(root);
  await writeFile(join(root, "runtime", ".runtime-update-recovery"), "private details");
  await expect(reader.read()).resolves.toEqual({
    engine: "shardx",
    status: "recovery_required",
    version: null,
  });
});

test("invalid cache root and unsupported platforms are unavailable, not absent", async () => {
  const { root, reader } = await fixture();
  await writeFile(join(root, "runtime"), "not-a-directory");
  await expect(reader.read()).resolves.toMatchObject({ status: "unavailable" });
  await expect(
    new ShardXEngineStatusReader(join(root, "missing"), "linux").read(),
  ).resolves.toMatchObject({ status: "unavailable" });
});
