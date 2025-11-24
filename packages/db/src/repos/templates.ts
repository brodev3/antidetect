import type { PrismaClient, Template } from '@prisma/client';
import { getClient } from '../transaction';

export async function upsertTemplate(name: string, settingsJson: string, isDefault = false, tx?: PrismaClient): Promise<Template> {
  const db = getClient(tx);
  const tpl = await db.template.upsert({
    where: { name },
    create: { name, settings: settingsJson, isDefault },
    update: { settings: settingsJson, isDefault },
  });
  if (isDefault) {
    await db.template.updateMany({ where: { id: { not: tpl.id } }, data: { isDefault: false } });
  }
  return tpl;
}

export async function findById(id: string, tx?: PrismaClient): Promise<Template | null> {
  const db = getClient(tx);
  return db.template.findUnique({ where: { id } });
}

export async function findByName(name: string, tx?: PrismaClient): Promise<Template | null> {
  const db = getClient(tx);
  return db.template.findUnique({ where: { name } });
}

export async function getDefault(tx?: PrismaClient): Promise<Template | null> {
  const db = getClient(tx);
  return db.template.findFirst({ where: { isDefault: true } });
}

export async function list(tx?: PrismaClient): Promise<Template[]> {
  const db = getClient(tx);
  return db.template.findMany({ orderBy: { updatedAt: 'desc' } });
}

export async function audit(event: string, payload?: unknown, profileId?: string, tx?: PrismaClient): Promise<unknown> {
  const db = getClient(tx);
  const data: Record<string, unknown> = { event, createdAt: new Date() };
  if (profileId) data.profileId = profileId;
  if (payload !== undefined) data.payload = JSON.stringify(payload);
  return (db as any).audit.create({ data });
}

export async function setDefault(id: string, tx?: PrismaClient): Promise<Template> {
  const db = getClient(tx);
  await db.template.updateMany({ data: { isDefault: false } });
  return db.template.update({ where: { id }, data: { isDefault: true } });
}
