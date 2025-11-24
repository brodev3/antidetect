import { PrismaClient } from '@prisma/client';
import { bindClient } from './transaction';
import * as profilesRepo from './repos/profiles';
import * as fpMetaRepo from './repos/fpMeta';
import * as settingsRepo from './repos/settings';
import * as proxyRepo from './repos/proxy';
import * as templatesRepo from './repos/templates';
import * as auditRepo from './repos/audit';

export const prisma = new PrismaClient();
bindClient(prisma);

export { profilesRepo, fpMetaRepo, settingsRepo, proxyRepo, templatesRepo, auditRepo };
export * from './transaction';



