import Link from 'next/link';
import type { MovementType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { manilaRange, parseDateInput } from '@/lib/dates';
import { MOVEMENT_TYPE } from '@/lib/labels';
import { Card, FilterBar, PageHeader } from '@/components/ui';
import { MovementsTable, movementInclude } from '../MovementsTable';

export const metadata = { title: 'Stock movements' };

const LIMIT = 500;

type SP = Promise<{ materialId?: string; type?: string; from?: string; to?: string }>;

export default async function MovementsPage({ searchParams }: { searchParams: SP }) {
  await requireUser('inventory');
  const { materialId = '', type = '', from = '', to = '' } = await searchParams;

  const where: Prisma.StockMovementWhereInput = {};
  if (Number(materialId)) where.materialId = Number(materialId);
  if (type in MOVEMENT_TYPE) where.type = type as MovementType;
  const fromOk = parseDateInput(from) ? from : '';
  const toOk = parseDateInput(to) ? to : '';
  if (fromOk || toOk) {
    const { start, end } = manilaRange(fromOk || '2000-01-01', toOk || '2999-12-31');
    where.createdAt = { gte: start, lt: end };
  }

  const [materials, rows, count] = await Promise.all([
    prisma.material.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.stockMovement.findMany({ where, orderBy: { id: 'desc' }, take: LIMIT, include: movementInclude }),
    prisma.stockMovement.count({ where }),
  ]);

  return (
    <div>
      <PageHeader
        title="Stock movements"
        subtitle={count > rows.length ? `Showing latest ${rows.length} of ${count} — narrow the filters to see more` : `${count} movements`}
        actions={<Link href="/inventory" className="btn-secondary">Back to inventory</Link>}
      />
      <Card>
        <FilterBar>
          <select name="materialId" defaultValue={materialId} className="input w-auto max-w-xs">
            <option value="">All materials</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select name="type" defaultValue={type} className="input w-auto">
            <option value="">All types</option>
            {Object.entries(MOVEMENT_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="text-sm">From <input type="date" name="from" defaultValue={fromOk} className="input w-auto" /></label>
          <label className="text-sm">To <input type="date" name="to" defaultValue={toOk} className="input w-auto" /></label>
        </FilterBar>
        <MovementsTable rows={rows} showMaterial />
      </Card>
    </div>
  );
}
