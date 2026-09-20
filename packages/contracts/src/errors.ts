import { z } from "zod";

export const apiErrorCodeSchema = z.enum(["VALIDATION_ERROR", "PROFILE_NOT_FOUND"]);

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(200),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
