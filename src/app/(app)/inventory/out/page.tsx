import { ASSIGNABLE_WORKER } from '@/lib/permissions';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser, getBranch } from '@/lib/auth';
import { levelsFor } from '@/lib/branches';
import { fmtQty } from '@/lib/money';
import { manilaDayRange } from '@/lib/dates';
import { Card, Empty, PageHeader, TableWrap } from '@/components/ui';
import { StockOutForm } from './StockOutForm';

export const metadata = { title: 'Stock out' };

type SP = Promise<{ material?: string }>;

export default async function StockOutPage({ searchParams }: { searchParams: SP }) {
  await requireUser('inventory');
  const { material } = await searchParams;
  const today = manilaDayRange();
  const time = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });

  const [materials, workers, outsToday] = await Promise.all([
    prisma.material.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, unit: true, stock: true, reorderLevel: true, level: true },
    }),
    prisma.user.findMany({ where: ASSIGNABLE_WORKER, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.stockMovement.findMany({
      where: { type: 'STOCK_OUT', createdAt: { gte: today.start, lt: today.end } },
      orderBy: { createdAt: 'desc' },
      include: {
        material: { select: { id: true, name: true, unit: true } },
        releasedTo: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock out"
        subtitle="Release materials to production or record usage / waste. Stock is deducted right away."
        actions={<Link href="/inventory/movements?type=STOCK_OUT" className="btn-secondary">All stock-outs</Link>}
      />
      <Card className="max-w-3xl">
        {materials.length === 0 ? <Empty>No materials yet.</Empty> : (
          <StockOutForm materials={materials} workers={workers} defaultMaterialId={Number(material) || undefined} levels={[...levelsFor(!!getBranch()?.simpleInventory)]} />
        )}
      </Card>

      <Card title={`Today's stock-outs (${outsToday.length})`}>
        {outsToday.length === 0 ? <Empty>Nothing taken out today.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Time</th><th>Material</th><th className="text-right">Qty</th><th>Released to</th><th>Notes</th><th>By</th></tr></thead>
              <tbody>
                {outsToday.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">{time.format(m.createdAt)}</td>
                    <td><Link href={`/inventory/${m.material.id}`} className="link">{m.material.name}</Link></td>
                    <td className="whitespace-nowrap text-right font-semibold text-red-600">{fmtQty(-m.quantity)} <span className="text-xs font-normal text-slate-500">{m.material.unit}</span></td>
                    <td>{m.releasedTo?.name ?? '—'}</td>
                    <td className="max-w-[16rem] text-slate-600">{m.notes ?? '—'}</td>
                    <td className="whitespace-nowrap">{m.user.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
