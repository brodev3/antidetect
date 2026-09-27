import { describe, expect, test } from "vitest";
import { InvalidBrowserRunTransitionError } from "../src/application/browserRuns/browser.run.errors.ts";
import {
  canTransitionBrowserRun,
  isBrowserRunOccupying,
  isBrowserRunTerminal,
  transitionBrowserRun,
} from "../src/application/browserRuns/browser.run.state.ts";

describe("browser run state machine", () => {
  test.each([
    ["starting", "running"],
    ["starting", "recovery_required"],
    ["running", "stopping"],
    ["running", "stopped"],
    ["stopping", "failed"],
    ["recovery_required", "running"],
    ["recovery_required", "failed"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionBrowserRun(from, to)).toBe(true);
    expect(transitionBrowserRun(from, to)).toBe(to);
  });

  test.each([
    ["starting", "stopped"],
    ["stopped", "running"],
    ["failed", "starting"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransitionBrowserRun(from, to)).toBe(false);
    expect(() => transitionBrowserRun(from, to)).toThrow(
      InvalidBrowserRunTransitionError,
    );
  });

  test("allows an idempotent same-status transition", () => {
    expect(transitionBrowserRun("stopped", "stopped")).toBe("stopped");
  });

  test("classifies occupying and terminal statuses", () => {
    expect(isBrowserRunOccupying("recovery_required")).toBe(true);
    expect(isBrowserRunOccupying("stopped")).toBe(false);
    expect(isBrowserRunTerminal("failed")).toBe(true);
    expect(isBrowserRunTerminal("running")).toBe(false);
  });
});
