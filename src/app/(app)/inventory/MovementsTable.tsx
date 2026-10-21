import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { fmtDateTime } from '@/lib/dates';
import { fmtQty, peso } from '@/lib/money';
import { MOVEMENT_TYPE } from '@/lib/labels';
import { Badge, Empty, TableWrap } from '@/components/ui';
import type { Tone } from '@/lib/labels';

/** Prisma include for rows passed to <MovementsTable>. */
export const movementInclude = {
  material: { select: { id: true, name: true, unit: true } },
  user: { select: { name: true } },
  releasedTo: { select: { name: true } },
  job: { select: { id: true, order: { select: { id: true, orderNo: true } } } },
  purchaseOrder: { select: { id: true, poNo: true } },
  conversion: { select: { id: true } },
} satisfies Prisma.StockMovementInclude;

export type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

const TYPE_TONE: Record<string, Tone> = {
  STOCK_IN: 'green', STOCK_OUT: 'amber', ADJUSTMENT: 'gray', CONVERSION_IN: 'blue', CONVERSION_OUT: 'purple', JOB_DEDUCT: 'red',
};

function Reference({ m }: { m: MovementRow }) {
  if (m.job) return <Link href={`/orders/${m.job.order.id}`} className="link">{m.job.order.orderNo}</Link>;
  if (m.purchaseOrder) return <Link href={`/purchase-orders/${m.purchaseOrder.id}`} className="link">{m.purchaseOrder.poNo}</Link>;
  if (m.conversion) return <Link href="/inventory/convert" className="link">Conversion #{m.conversion.id}</Link>;
  return <span className="text-slate-400">—</span>;
}

export function MovementsTable({ rows, showMaterial = false }: { rows: MovementRow[]; showMaterial?: boolean }) {
  if (rows.length === 0) return <Empty>No stock movements yet.</Empty>;
  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>{showMaterial && <th>Material</th>}<th>Type</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th>
            <th className="text-right">Balance after</th><th>Reference</th><th>Released to</th><th>Notes</th><th>By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</td>
              {showMaterial && <td><Link href={`/inventory/${m.material.id}`} className="link">{m.material.name}</Link></td>}
              <td><Badge tone={TYPE_TONE[m.type] ?? 'gray'}>{MOVEMENT_TYPE[m.type] ?? m.type}</Badge>{m.returnedAt && <div className="mt-1"><Badge tone="green">Returned</Badge></div>}</td>
              <td className={`whitespace-nowrap text-right font-semibold ${m.quantity < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {m.quantity > 0 ? '+' : ''}{fmtQty(m.quantity)} <span className="text-xs font-normal text-slate-500">{m.material.unit}</span>
              </td>
              <td className="text-right">{peso(m.unitCost)}</td>
              <td className={`text-right ${m.balanceAfter < 0 ? 'text-red-600' : ''}`}>{fmtQty(m.balanceAfter)}</td>
              <td className="whitespace-nowrap"><Reference m={m} /></td>
              <td className="whitespace-nowrap">{m.releasedTo?.name ?? <span className="text-slate-400">—</span>}</td>
              <td className="max-w-[16rem] text-slate-600">{m.notes ?? '—'}</td>
              <td className="whitespace-nowrap">{m.user.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
