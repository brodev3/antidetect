import type { PrismaClient, Settings } from '@prisma/client';
import { getClient } from '../transaction';

export async function upsertSettings(
  profileId: string,
  data: {
    headless?: boolean;
    args?: string;
    fingerprintOptions?: string | null;
    proxyPluginOptions?: string | null;
  },
  tx?: PrismaClient,
): Promise<Settings> {
  const db = getClient(tx);
  return db.settings.upsert({
    where: { profileId },
    create: {
      profileId,
      headless: data.headless ?? false,
      args: data.args ?? '',
      fingerprintOptions: data.fingerprintOptions ?? null,
      proxyPluginOptions: data.proxyPluginOptions ?? null,
    },
    update: {
      headless: data.headless ?? false,
      args: data.args ?? '',
      fingerprintOptions: data.fingerprintOptions ?? null,
      proxyPluginOptions: data.proxyPluginOptions ?? null,
    },
  });
}

export async function getSettings(profileId: string, tx?: PrismaClient): Promise<Settings | null> {
  const db = getClient(tx);
  return db.settings.findUnique({ where: { profileId } });
}
