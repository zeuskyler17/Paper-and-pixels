import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fmtQty } from '@/lib/money';
import { MATERIAL_LEVEL, MATERIAL_USE } from '@/lib/labels';
import { Card, PageHeader } from '@/components/ui';
import { CleanupForm, type CleanupRow } from './CleanupForm';
import { deactivateMaterials, deleteMaterials } from './actions';

export const metadata = { title: 'Inventory clean-up' };

/** Stock activity before this moment is the demo / setup data; after it, the shop's own. */
const SETUP_DONE = new Date('2026-10-16T06:00:00Z');

export default async function CleanupPage() {
  await requireUser('admin');
  const mats = await prisma.material.findMany({
    orderBy: [{ active: 'desc' }, { usedFor: 'asc' }, { name: 'asc' }],
    include: {
      bomLines: { select: { product: { select: { name: true } } } },
      _count: { select: { movements: true, poItems: true, conversionsIn: true, conversionsOut: true } },
    },
  });
  const real = await prisma.stockMovement.groupBy({ by: ['materialId'], where: { createdAt: { gt: SETUP_DONE } }, _count: { _all: true } });
  const realCount = new Map(real.map((r) => [r.materialId, r._count._all]));

  const rows: CleanupRow[] = mats.map((m) => ({
    id: m.id, name: m.name, level: MATERIAL_LEVEL[m.level] ?? m.level, usedFor: m.usedFor ? MATERIAL_USE[m.usedFor] : '—',
    stock: `${fmtQty(m.stock)} ${m.unit}`, active: m.active,
    products: [...new Set(m.bomLines.map((b) => b.product.name))],
    movements: m._count.movements, realMovements: realCount.get(m.id) ?? 0,
    blocked: m._count.poItems ? 'On a purchase order' : m._count.conversionsIn || m._count.conversionsOut ? 'Used in a cutting / conversion' : null,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory clean-up"
        subtitle="Tick the materials you don't actually stock, then delete them (sample data) or deactivate them (keep history). Admin only."
        actions={<Link href="/inventory" className="btn-secondary">Back to inventory</Link>}
      />
      <Card>
        <CleanupForm rows={rows} onDelete={deleteMaterials} onDeactivate={deactivateMaterials} />
      </Card>
      <p className="text-[12px] text-slate-500">
        "History rows" counts every stock movement for the material; "after setup" are the ones made since the demo data was loaded.
        Deleting a material that products use removes it from those products' bill of materials — re-add real materials there afterwards.
      </p>
    </div>
  );
}
