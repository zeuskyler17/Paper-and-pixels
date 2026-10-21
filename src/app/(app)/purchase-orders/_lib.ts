import 'server-only';
import { prisma } from '@/lib/db';
import type { POMaterial } from './POForm';

/** Suppliers and materials for the PO form. Keeps inactive ones that are already referenced. */
export async function poFormOptions(keep: { supplierId?: number | null; materialIds?: number[] } = {}) {
  const [suppliers, materials] = await Promise.all([
    prisma.supplier.findMany({
      where: { OR: [{ active: true }, { id: keep.supplierId ?? -1 }] }, orderBy: { name: 'asc' }, select: { id: true, name: true },
    }),
    prisma.material.findMany({
      where: { OR: [{ active: true }, { id: { in: keep.materialIds ?? [] } }] }, orderBy: { name: 'asc' },
      select: { id: true, name: true, unit: true, unitCost: true, supplierId: true, sku: true, stock: true },
    }),
  ]);
  return { suppliers, materials: materials as POMaterial[] };
}

/** Percent of ordered quantity received (by quantity across lines, capped at 100). */
export function receivedPercent(items: { quantity: number; receivedQty: number }[]): number {
  const ordered = items.reduce((s, i) => s + i.quantity, 0);
  if (ordered <= 0) return 0;
  const received = items.reduce((s, i) => s + Math.min(i.receivedQty, i.quantity), 0);
  return Math.min(100, Math.round((received / ordered) * 100));
}
