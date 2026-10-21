import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from './db';

export async function audit(
  db: Tx | typeof prisma,
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number,
  summary: string,
  data?: Prisma.InputJsonValue,
) {
  await db.auditLog.create({
    data: { userId, action, entity, entityId: String(entityId), summary, data },
  });
}
