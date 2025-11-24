import type { PrismaClient, Proxy } from '@prisma/client';
import { getClient } from '../transaction';

export async function findByProfile(profileId: string, tx?: PrismaClient): Promise<Proxy | null> {
  const db = getClient(tx);
  return db.proxy.findUnique({ where: { profileId } });
}

export async function upsertProxy(
  profileId: string,
  data: { protocol: string; host: string; port: number; login?: string | null; password?: string | null },
  tx?: PrismaClient,
): Promise<Proxy> {
  const db = getClient(tx);
  return db.proxy.upsert({
    where: { profileId },
    update: {
      protocol: data.protocol,
      host: data.host,
      port: data.port,
      login: data.login ?? null,
      password: data.password ?? null,
    },
    create: {
      profileId,
      protocol: data.protocol,
      host: data.host,
      port: data.port,
      login: data.login ?? null,
      password: data.password ?? null,
    },
  });
}

export async function deleteByProfile(profileId: string, tx?: PrismaClient): Promise<void> {
  const db = getClient(tx);
  await db.proxy.delete({ where: { profileId } }).catch(() => {});
}

export async function updateMetrics(
  profileId: string,
  data: { lastCheck?: Date | null; latencyMs?: number | null; country?: string | null },
  tx?: PrismaClient,
): Promise<Proxy> {
  const db = getClient(tx);
  return db.proxy.update({
    where: { profileId },
    data: {
      lastCheck: data.lastCheck,
      latencyMs: data.latencyMs ?? null,
      country: data.country ?? null,
    },
  });
}
