import type { PrismaClient } from '@prisma/client';

let defaultClient: PrismaClient | null = null;

export function bindClient(client: PrismaClient): void {
  defaultClient = client;
}

export function getClient<T extends PrismaClient>(tx?: T): T | PrismaClient {
  if (tx) return tx;
  if (!defaultClient) {
    throw new Error('Prisma client is not bound. Call bindClient() from index.ts');
  }
  return defaultClient;
}

export async function withTransaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  const db = getClient();
  return db.$transaction(async (tx) => fn(tx as PrismaClient));
}



