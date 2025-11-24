import type { PrismaClient, Profile } from '@prisma/client';
import { getClient } from '../transaction';

export async function createProfile(name: string, profileDir: string, tx?: PrismaClient): Promise<Profile> {
  const db = getClient(tx);
  return db.profile.create({ data: { name, profileDir } });
}

export async function findByName(name: string, tx?: PrismaClient): Promise<Profile | null> {
  const db = getClient(tx);
  return db.profile.findUnique({ where: { name } });
}

export async function setOpenState(profileId: string, isOpen: boolean, tx?: PrismaClient): Promise<Profile> {
  const db = getClient(tx);
  return db.profile.update({
    where: { id: profileId },
    data: {
      isOpen,
      lastOpenedAt: isOpen ? new Date() : undefined,
      lastClosedAt: !isOpen ? new Date() : undefined,
    },
  });
}

export async function getById(profileId: string, tx?: PrismaClient): Promise<Profile | null> {
  const db = getClient(tx);
  return db.profile.findUnique({ where: { id: profileId } });
}

export async function list(tx?: PrismaClient): Promise<Profile[]> {
  const db = getClient(tx);
  return db.profile.findMany({ orderBy: { updatedAt: 'desc' } });
}

export async function rename(profileId: string, newName: string, newDir: string, tx?: PrismaClient): Promise<Profile> {
  const db = getClient(tx);
  return db.profile.update({ where: { id: profileId }, data: { name: newName, profileDir: newDir } });
}

export async function remove(profileId: string, tx?: PrismaClient): Promise<void> {
  const db = getClient(tx);
  await db.proxy.deleteMany({ where: { profileId } }).catch(() => {});
  await db.settings.deleteMany({ where: { profileId } }).catch(() => {});
  await db.fingerprintMeta.deleteMany({ where: { profileId } }).catch(() => {});
  await db.audit.deleteMany({ where: { profileId } }).catch(() => {});
  await db.profile.delete({ where: { id: profileId } });
}
