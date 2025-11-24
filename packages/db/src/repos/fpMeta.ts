import type { PrismaClient, FingerprintMeta } from '@prisma/client';
import { getClient } from '../transaction';

export async function upsertMeta(
  profileId: string,
  data: {
    sha256: string;
    size: number;
    userAgent?: string | null;
    browser?: string | null;
    os?: string | null;
    fetchOptions?: string | null;
    fingerprintOptions?: string | null;
  },
  tx?: PrismaClient,
): Promise<FingerprintMeta> {
  const db = getClient(tx);
  return db.fingerprintMeta.upsert({
    where: { profileId },
    create: {
      profileId,
      sha256: data.sha256,
      size: data.size,
      userAgent: data.userAgent ?? null,
      browser: data.browser ?? null,
      os: data.os ?? null,
      fetchOptions: data.fetchOptions ?? null,
      fingerprintOptions: data.fingerprintOptions ?? null,
    },
    update: {
      sha256: data.sha256,
      size: data.size,
      userAgent: data.userAgent ?? null,
      browser: data.browser ?? null,
      os: data.os ?? null,
      fetchOptions: data.fetchOptions ?? null,
      fingerprintOptions: data.fingerprintOptions ?? null,
    },
  });
}
