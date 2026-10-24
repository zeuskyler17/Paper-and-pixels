import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, manilaDayRange, parseDateInput } from '@/lib/dates';
import { DELIVERY_METHOD, DELIVERY_STATUS } from '@/lib/labels';
import { Card, Empty, FilterBar, PageHeader, StatusBadge, TableWrap } from '@/components/ui';
import { DeliveryTabs } from './_tabs';

export const metadata = { title: 'Deliveries' };

type SP = Promise<{ status?: string; method?: string; from?: string; to?: string; q?: string }>;

export default async function DeliveriesPage({ searchParams }: { searchParams: SP }) {
  await requireUser('deliveries');
  const { status = 'open', method = '', from = '', to = '', q = '' } = await searchParams;

  const where: Prisma.DeliveryWhereInput = {};
  if (status === 'open') where.status = { in: ['SCHEDULED', 'IN_TRANSIT'] };
  else if (status in DELIVERY_STATUS) where.status = status as Prisma.DeliveryWhereInput['status'];
  if (method in DELIVERY_METHOD) where.method = method as Prisma.DeliveryWhereInput['method'];
  const range: Prisma.DateTimeNullableFilter = {};
  if (parseDateInput(from)) range.gte = manilaDayRange(from).start;
  if (parseDateInput(to)) range.lt = manilaDayRange(to).end;
  if (range.gte || range.lt) where.scheduledDate = range;
  if (q) {
    where.OR = [
      { order: { orderNo: { contains: q, mode: 'insensitive' } } },
      { order: { customer: { name: { contains: q, mode: 'insensitive' } } } },
      { recipient: { contains: q, mode: 'insensitive' } },
      { trackingNo: { contains: q, mode: 'insensitive' } },
    ];
  }

  const rows = await prisma.delivery.findMany({
    where,
    orderBy: [{ scheduledDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 500,
    include: { order: { select: { id: true, orderNo: true, customer: { select: { name: true } } } } },
  });

  return (
    <div>
      <PageHeader
        title="Deliveries & pickups"
        subtitle={`${rows.length} record${rows.length === 1 ? '' : 's'}`}
        actions={<Link href="/deliveries/new" className="btn-primary">+ New delivery</Link>}
      />
      <DeliveryTabs active="records" />
      <Card>
        <FilterBar>
          <input name="q" defaultValue={q} placeholder="Order no., customer, tracking" className="input w-56" />
          <select name="status" defaultValue={status} className="input w-auto">
            <option value="open">Open (scheduled / in transit)</option>
            <option value="all">All statuses</option>
            {Object.entries(DELIVERY_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select name="method" defaultValue={method} className="input w-auto">
            <option value="">All methods</option>
            {Object.entries(DELIVERY_METHOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="text-xs text-slate-600">Scheduled from<input type="date" name="from" defaultValue={from} className="input w-auto" /></label>
          <label className="text-xs text-slate-600">to<input type="date" name="to" defaultValue={to} className="input w-auto" /></label>
        </FilterBar>
        {rows.length === 0 ? <Empty>No deliveries found.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Order no.</th><th>Customer</th><th>Method</th><th>Address</th><th>Rider / tracking</th><th className="text-right">Fee</th><th>Scheduled</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td><Link href={`/deliveries/${d.id}`} className="link">{d.order.orderNo}</Link></td>
                    <td>{d.order.customer.name}{d.recipient && d.recipient !== d.order.customer.name ? <div className="text-xs text-slate-500">to {d.recipient}</div> : null}</td>
                    <td className="whitespace-nowrap">{DELIVERY_METHOD[d.method]}</td>
                    <td className="max-w-[16rem] truncate" title={d.address ?? ''}>{d.address ?? '—'}</td>
                    <td>{[d.rider, d.trackingNo].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="text-right">{d.fee ? peso(d.fee) : '—'}</td>
                    <td className="whitespace-nowrap">{fmtDate(d.scheduledDate)}</td>
                    <td><StatusBadge value={d.status} labels={DELIVERY_STATUS} /></td>
                    <td className="whitespace-nowrap text-right"><Link href={`/print/delivery/${d.id}`} target="_blank" className="btn-secondary btn-sm" title="Print delivery / pickup slip">🖨 Slip</Link></td>
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
