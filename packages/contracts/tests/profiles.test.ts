import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createProfileRequestSchema,
  listProfilesQuerySchema,
  listProfilesResponseSchema,
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  profilePathParamsSchema,
  profileResponseSchema,
  updateProfileFingerprintModeRequestSchema,
} from "../src/profiles.ts";

const profile = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  profileCode: "profile-001",
  displayName: "Research profile",
  fingerprintEnabled: true,
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
      fingerprintEnabled: true,
    });
  });

  test("accepts an explicit no-fingerprint choice", () => {
    expect(
      createProfileRequestSchema.parse({
        displayName: "Research profile",
        fingerprintEnabled: false,
      }),
    ).toEqual({ displayName: "Research profile", fingerprintEnabled: false });
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

describe("updateProfileFingerprintModeRequestSchema", () => {
  test.each([true, false])("accepts fingerprintEnabled=%s", (enabled) => {
    expect(
      updateProfileFingerprintModeRequestSchema.parse({
        fingerprintEnabled: enabled,
      }),
    ).toEqual({ fingerprintEnabled: enabled });
  });

  test.each([
    {},
    { fingerprintEnabled: "false" },
    { fingerprintEnabled: false, identityRef: "client-selected-identity" },
  ])("rejects a missing, invalid, or client-selected identity", (value) => {
    expect(updateProfileFingerprintModeRequestSchema.safeParse(value).success).toBe(
      false,
    );
  });
});

describe("profile response contracts", () => {
  test("accepts a strict profile response", () => {
    expect(profileResponseSchema.parse(profile)).toEqual(profile);
    expect(
      listProfilesResponseSchema.parse({ items: [profile], nextOffset: 50 }),
    ).toEqual({ items: [profile], nextOffset: 50 });
  });

  test("accepts a profile without an assigned fingerprint", () => {
    const profileWithoutFingerprint = {
      ...profile,
      fingerprintEnabled: false,
      identityRef: null,
    };

    expect(profileResponseSchema.parse(profileWithoutFingerprint)).toEqual(
      profileWithoutFingerprint,
    );
  });

  test.each([
    { ...profile, id: "not-a-uuid" },
    { ...profile, createdAt: "20 September 2026" },
    { ...profile, identityRef: "" },
    { ...profile, identityRef: null },
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
    expect(listProfilesQuerySchema.parse({})).toEqual({
      limit: 50,
      offset: 0,
      sortBy: "createdAt",
      sortOrder: "asc",
    });
  });

  test.each([
    [
      { limit: "1", offset: "0" },
      { limit: 1, offset: 0, sortBy: "createdAt", sortOrder: "asc" },
    ],
    [
      { limit: "100", offset: "250" },
      { limit: 100, offset: 250, sortBy: "createdAt", sortOrder: "asc" },
    ],
    [
      { limit: 25, offset: 10 },
      { limit: 25, offset: 10, sortBy: "createdAt", sortOrder: "asc" },
    ],
    [
      {
        limit: "10",
        offset: "0",
        search: "  research ",
        sortBy: "displayName",
        sortOrder: "desc",
      },
      {
        limit: 10,
        offset: 0,
        search: "research",
        sortBy: "displayName",
        sortOrder: "desc",
      },
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
    { limit: "100", offset: "9007199254740900" },
    { search: "a".repeat(PROFILE_DISPLAY_NAME_MAX_LENGTH + 1) },
    { sortBy: "id" },
    { sortOrder: "sideways" },
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
