import { z } from "zod";
import { profileIdSchema } from "./profiles.js";

export const browserRunStatusSchema = z.enum([
  "starting",
  "running",
  "stopping",
  "recovery_required",
  "stopped",
  "failed",
]);

export const browserRunResponseSchema = z.strictObject({
  id: z.uuid(),
  profileId: profileIdSchema,
  status: browserRunStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const browserRunStateResponseSchema = z.strictObject({
  run: browserRunResponseSchema.nullable(),
});

export type BrowserRunStatus = z.infer<typeof browserRunStatusSchema>;
export type BrowserRunResponse = z.infer<typeof browserRunResponseSchema>;
export type BrowserRunStateResponse = z.infer<typeof browserRunStateResponseSchema>;
