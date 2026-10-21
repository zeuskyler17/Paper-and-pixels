import 'server-only';
import { prisma } from '@/lib/db';
import type { CopySource } from './CopyOptionsField';

/** Products that have options to copy, same-category first in the picker. */
export async function copySources(excludeId?: number): Promise<CopySource[]> {
  const rows = await prisma.product.findMany({
    where: { options: { some: {} }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: [{ category: { sortOrder: 'asc' } }, { active: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, categoryId: true, category: { select: { name: true } }, _count: { select: { options: true, bom: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, categoryId: r.categoryId, categoryName: r.category.name, options: r._count.options, bom: r._count.bom }));
}
