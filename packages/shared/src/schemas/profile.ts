import { z } from 'zod';
import { ProxySchema } from './proxy';

/** DTO representing a profile entry enriched with runtime flags. */
export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  profileDir: z.string().min(1),
  fingerprint: z.boolean().default(false),
  proxy: ProxySchema.optional(),
});

export type ProfileDTO = z.infer<typeof ProfileSchema>;



