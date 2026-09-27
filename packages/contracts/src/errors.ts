import { z } from "zod";

export const apiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "PROFILE_NOT_FOUND",
  "ACTIVE_BROWSER_RUN_CONFLICT",
  "BROWSER_RUN_START_IN_PROGRESS",
  "BROWSER_RUNTIME_LAUNCH_FAILED",
  "BROWSER_RUNTIME_RECOVERY_REQUIRED",
  "BROWSER_RUNTIME_STOP_FAILED",
]);

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(200),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
