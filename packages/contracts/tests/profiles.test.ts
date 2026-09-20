import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createProfileRequestSchema,
  listProfilesQuerySchema,
  listProfilesResponseSchema,
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  profilePathParamsSchema,
  profileResponseSchema,
} from "../src/profiles.ts";

const profile = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  displayName: "Research profile",
  identityRef: "test-identity:550e8400-e29b-41d4-a716-446655440000",
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T10:00:00.000Z",
} as const;

describe("createProfileRequestSchema", () => {
  test("trims and accepts a valid display name", () => {
    expect(
      createProfileRequestSchema.parse({ displayName: "  Research profile  " }),
    ).toEqual({
      displayName: "Research profile",
    });
  });

  test.each([
    {},
    { displayName: "" },
    { displayName: "   " },
    { displayName: "a".repeat(PROFILE_DISPLAY_NAME_MAX_LENGTH + 1) },
    { displayName: "Profile", id: profile.id },
  ])("rejects an invalid create request", (value) => {
    expect(createProfileRequestSchema.safeParse(value).success).toBe(false);
  });
});

describe("profile response contracts", () => {
  test("accepts a strict profile response", () => {
    expect(profileResponseSchema.parse(profile)).toEqual(profile);
    expect(
      listProfilesResponseSchema.parse({ items: [profile], nextOffset: 50 }),
    ).toEqual({ items: [profile], nextOffset: 50 });
  });

  test.each([
    { ...profile, id: "not-a-uuid" },
    { ...profile, createdAt: "20 September 2026" },
    { ...profile, identityRef: "" },
    { ...profile, internalState: "must not cross the boundary" },
  ])("rejects an invalid profile response", (value) => {
    expect(profileResponseSchema.safeParse(value).success).toBe(false);
  });

  test("accepts only a UUID profile path parameter", () => {
    expect(profilePathParamsSchema.parse({ profileId: profile.id })).toEqual({
      profileId: profile.id,
    });
    expect(
      profilePathParamsSchema.safeParse({ profileId: "profile-001" }).success,
    ).toBe(false);
  });
});

describe("listProfilesQuerySchema", () => {
  test("applies bounded defaults", () => {
    expect(listProfilesQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  test.each([
    [
      { limit: "1", offset: "0" },
      { limit: 1, offset: 0 },
    ],
    [
      { limit: "100", offset: "250" },
      { limit: 100, offset: 250 },
    ],
    [
      { limit: 25, offset: 10 },
      { limit: 25, offset: 10 },
    ],
  ] as const)("normalizes valid query values", (input, expected) => {
    expect(listProfilesQuerySchema.parse(input)).toEqual(expected);
  });

  test.each([
    { limit: "" },
    { limit: "0" },
    { limit: "101" },
    { limit: "1.5" },
    { limit: "abc" },
    { offset: "-1" },
    { offset: "1.5" },
    { offset: "01" },
    { offset: "9007199254740992" },
    { extra: "field" },
  ])("rejects an invalid or unbounded query", (value) => {
    expect(listProfilesQuerySchema.safeParse(value).success).toBe(false);
  });

  test("can be represented as both input and output JSON Schema", () => {
    expect(() =>
      z.toJSONSchema(listProfilesQuerySchema, { io: "input" }),
    ).not.toThrow();
    expect(() =>
      z.toJSONSchema(listProfilesQuerySchema, { io: "output" }),
    ).not.toThrow();
  });
});
