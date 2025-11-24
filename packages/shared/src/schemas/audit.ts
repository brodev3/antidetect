import { z } from 'zod';

/** Enumerates all audit events emitted by core services. */
export const AuditEventSchema = z.enum([
  'profile_opened',
  'profile_closed',
  'profile_renamed',
  'profile_deleted',
  'proxy_set',
  'proxy_deleted',
  'fingerprint_rotated',
  'settings_saved',
]);

export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** Helper object for ergonomic import of audit event constants. */
export const AuditEvent = AuditEventSchema.Enum;



