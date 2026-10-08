import { z } from "zod";

export const engineStatusSchema = z.enum([
  "not_installed",
  "files_detected",
  "incomplete",
  "recovery_required",
  "unavailable",
]);

export const engineStatusResponseSchema = z.object({
  engine: z.literal("shardx"),
  status: engineStatusSchema,
  version: z
    .string()
    .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}\.\d{1,4}$/)
    .nullable(),
});

export type EngineStatus = z.infer<typeof engineStatusSchema>;
export type EngineStatusResponse = z.infer<typeof engineStatusResponseSchema>;
