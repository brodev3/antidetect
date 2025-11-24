import type { PrismaClient } from '@prisma/client';
import { getClient } from '../transaction';

export async function create(event: string, payload?: unknown, profileId?: string, tx?: PrismaClient): Promise<unknown> {
  const db = getClient(tx);
  const data: Record<string, unknown> = { event, createdAt: new Date() };
  if (profileId) data.profileId = profileId;
  if (payload !== undefined) data.payload = JSON.stringify(payload);
  return (db as any).audit.create({ data });
}

export async function list(
  opts?: { profileId?: string; event?: string; limit?: number },
  tx?: PrismaClient,
): Promise<unknown[]> {
  const db = getClient(tx);
  const where: Record<string, unknown> = {};
  if (opts?.profileId) where.profileId = opts.profileId;
  if (opts?.event) where.event = opts.event;
  return (db as any).audit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: opts?.limit ?? 100,
  });
}
