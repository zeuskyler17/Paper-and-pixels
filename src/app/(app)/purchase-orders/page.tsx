import Link from 'next/link';
import type { POStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, isOverdue } from '@/lib/dates';
import { PO_STATUS } from '@/lib/labels';
import { Card, Empty, FilterBar, PageHeader, StatusBadge, TableWrap } from '@/components/ui';
import { receivedPercent } from './_lib';

export const metadata = { title: 'Purchase orders' };

type SP = Promise<{ status?: string; supplierId?: string; q?: string }>;

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: SP }) {
  await requireUser('purchasing');
  const { status = 'open', supplierId = '', q = '' } = await searchParams;

  const where: Prisma.PurchaseOrderWhereInput = {};
  if (status === 'open') where.status = { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] };
  else if (status in PO_STATUS) where.status = status as POStatus;
  if (Number(supplierId)) where.supplierId = Number(supplierId);
  if (q) where.poNo = { contains: q, mode: 'insensitive' };

  const [suppliers, pos] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.purchaseOrder.findMany({
      where, orderBy: { id: 'desc' }, take: 300,
      include: { supplier: { select: { id: true, name: true } }, items: { select: { quantity: true, receivedQty: true } } },
    }),
  ]);

  return (
    <div>
      <PageHeader title="Purchase orders" subtitle={`${pos.length} shown`} actions={<Link href="/purchase-orders/new" className="btn-primary">+ New PO</Link>} />
      <Card>
        <FilterBar>
          <input name="q" defaultValue={q} placeholder="PO no." className="input w-40" />
          <select name="status" defaultValue={status} className="input w-auto">
            <option value="open">Open (draft / sent / partial)</option>
            <option value="all">All statuses</option>
            {Object.entries(PO_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select name="supplierId" defaultValue={supplierId} className="input w-auto max-w-xs">
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </FilterBar>
        {pos.length === 0 ? <Empty>No purchase orders found.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>PO no.</th><th>Supplier</th><th>Order date</th><th>Expected</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Received</th><th /></tr></thead>
              <tbody>
                {pos.map((po) => {
                  const pct = receivedPercent(po.items);
                  const late = (po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED') && isOverdue(po.expectedDate);
                  return (
                    <tr key={po.id}>
                      <td><Link href={`/purchase-orders/${po.id}`} className="link">{po.poNo}</Link></td>
                      <td><Link href={`/suppliers/${po.supplier.id}`} className="hover:underline">{po.supplier.name}</Link></td>
                      <td className="whitespace-nowrap">{fmtDate(po.orderDate)}</td>
                      <td className={`whitespace-nowrap ${late ? 'font-semibold text-red-600' : ''}`}>{fmtDate(po.expectedDate)}{late && ' (late)'}</td>
                      <td><StatusBadge value={po.status} labels={PO_STATUS} /></td>
                      <td className="text-right">{peso(po.total)}</td>
                      <td className="text-right">
                        {po.status === 'CANCELLED' ? '—' : (
                          <div className="flex items-center justify-end gap-2">
                            <div className="hidden h-1.5 w-16 overflow-hidden rounded bg-slate-200 sm:block"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                            <span>{pct}%</span>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right"><Link href={`/print/po/${po.id}`} target="_blank" className="btn-secondary btn-sm" title="Print purchase order">🖨 PO</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
