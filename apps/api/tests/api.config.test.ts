import { expect, test } from "vitest";
import {
  formatApiHostForUrl,
  parseApiHost,
  parseApiPort,
  readApiServerConfig,
} from "../src/config/api.server.ts";

test.each(["0.0.0.0", "localhost", "192.168.1.10", "::ffff:127.0.0.1"])(
  "rejects non-literal loopback API_HOST %s",
  (host) => {
    expect(() => parseApiHost(host)).toThrow(
      "API_HOST must be exactly 127.0.0.1 or ::1",
    );
  },
);

test.each([
  [undefined, "127.0.0.1"],
  ["127.0.0.1", "127.0.0.1"],
  ["::1", "::1"],
] as const)("accepts loopback API_HOST %s", (value, expected) => {
  expect(parseApiHost(value)).toBe(expected);
});

test.each(["", "3000x", "1.5", "0", "65536"])(
  "rejects malformed API_PORT %s",
  (port) => {
    expect(() => parseApiPort(port)).toThrow(
      "API_PORT must be an integer between 1 and 65535",
    );
  },
);

test("reads strict API server configuration", () => {
  expect(readApiServerConfig({ API_HOST: "::1", API_PORT: "3456" })).toEqual({
    host: "::1",
    port: 3456,
  });
  expect(formatApiHostForUrl("::1")).toBe("[::1]");
});
