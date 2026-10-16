import { z } from "zod";

export const PROFILE_DISPLAY_NAME_MAX_LENGTH = 100;
export const PROFILE_CODE_MAX_LENGTH = 32;
export const PROFILE_LIST_DEFAULT_LIMIT = 50;
export const PROFILE_LIST_MAX_LIMIT = 100;
export const PROFILE_LIST_DEFAULT_SORT_BY = "createdAt" as const;
export const PROFILE_LIST_DEFAULT_SORT_ORDER = "asc" as const;
export const PROFILE_LIST_SORT_BY_VALUES = ["createdAt", "displayName"] as const;
export const PROFILE_LIST_SORT_ORDER_VALUES = ["asc", "desc"] as const;
export const FINGERPRINT_PLATFORMS = ["Windows", "macOS", "Linux"] as const;
export const DEFAULT_FINGERPRINT_PLATFORM = "Windows" as const;
export const fingerprintPlatformSchema = z.enum(FINGERPRINT_PLATFORMS);
export type FingerprintPlatform = z.infer<typeof fingerprintPlatformSchema>;

export const profileIdSchema = z.uuid();
export const profileCodeSchema = z
  .string()
  .regex(/^profile-\d+$/)
  .max(PROFILE_CODE_MAX_LENGTH);

export const profileResponseSchema = z
  .strictObject({
    id: profileIdSchema,
    profileCode: profileCodeSchema,
    displayName: z.string().min(1).max(PROFILE_DISPLAY_NAME_MAX_LENGTH),
    fingerprintPlatform: fingerprintPlatformSchema,
    fingerprintEnabled: z.boolean(),
    identityRef: z.string().min(1).max(200).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    ({ fingerprintEnabled, identityRef }) =>
      !fingerprintEnabled || identityRef !== null,
    {
      message: "An enabled fingerprint requires an identity reference",
      path: ["identityRef"],
    },
  );

export const createProfileRequestSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(PROFILE_DISPLAY_NAME_MAX_LENGTH),
  fingerprintEnabled: z.boolean().default(true),
  fingerprintPlatform: fingerprintPlatformSchema.default(DEFAULT_FINGERPRINT_PLATFORM),
});

export const updateProfileFingerprintModeRequestSchema = z.strictObject({
  fingerprintEnabled: z.boolean(),
});

export const updateProfileFingerprintPlatformRequestSchema = z.strictObject({
  fingerprintPlatform: fingerprintPlatformSchema,
});

export const profilePathParamsSchema = z.strictObject({
  profileId: profileIdSchema,
});

const queryIntegerSchema = z.union([
  z.number(),
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .transform((value) => Number(value)),
]);

const safeQueryIntegerSchema = queryIntegerSchema.pipe(
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
);

export const listProfilesQuerySchema = z
  .strictObject({
    limit: safeQueryIntegerSchema
      .pipe(z.number().min(1).max(PROFILE_LIST_MAX_LIMIT))
      .default(PROFILE_LIST_DEFAULT_LIMIT),
    offset: safeQueryIntegerSchema.default(0),
    search: z.string().trim().max(PROFILE_DISPLAY_NAME_MAX_LENGTH).optional(),
    sortBy: z.enum(PROFILE_LIST_SORT_BY_VALUES).default(PROFILE_LIST_DEFAULT_SORT_BY),
    sortOrder: z
      .enum(PROFILE_LIST_SORT_ORDER_VALUES)
      .default(PROFILE_LIST_DEFAULT_SORT_ORDER),
  })
  .refine(({ limit, offset }) => Number.isSafeInteger(limit + offset), {
    message: "Offset and limit exceed the safe integer range",
    path: ["offset"],
  });

export const listProfilesResponseSchema = z.strictObject({
  items: z.array(profileResponseSchema),
  nextOffset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type CreateProfileRequest = z.input<typeof createProfileRequestSchema>;
export type UpdateProfileFingerprintModeRequest = z.infer<
  typeof updateProfileFingerprintModeRequestSchema
>;
export type UpdateProfileFingerprintPlatformRequest = z.infer<
  typeof updateProfileFingerprintPlatformRequestSchema
>;
export type ProfilePathParams = z.infer<typeof profilePathParamsSchema>;
export type ListProfilesQuery = z.infer<typeof listProfilesQuerySchema>;
export type ListProfilesResponse = z.infer<typeof listProfilesResponseSchema>;
