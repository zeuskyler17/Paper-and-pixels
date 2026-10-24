import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { addDays, fmtDateTime, manilaDayRange, parseDateInput, todayManila } from '@/lib/dates';
import { Badge, Card, Empty, FilterBar, PageHeader, TableWrap } from '@/components/ui';
import { DeliveryTabs } from '../_tabs';

export const metadata = { title: 'Released orders' };

type SP = Promise<{ from?: string; to?: string; q?: string }>;

/** Orders marked Released / Delivered (from the order page, the dashboard or the production board), newest first. */
export default async function ReleasedOrdersPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser(['deliveries', 'orders']);
  const sp = await searchParams;
  const to = parseDateInput(sp.to ?? '') ? sp.to! : todayManila();
  const from = parseDateInput(sp.from ?? '') ? sp.from! : addDays(to, -29);
  const q = (sp.q ?? '').trim();

  const where: Prisma.OrderWhereInput = {
    status: 'DELIVERED',
    deliveredAt: { gte: manilaDayRange(from).start, lt: manilaDayRange(to).end },
    ...(q ? { OR: [{ orderNo: { contains: q, mode: 'insensitive' } }, { customer: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
  };
  const orders = await prisma.order.findMany({
    where,
    orderBy: { deliveredAt: 'desc' },
    take: 500,
    select: {
      id: true, orderNo: true, total: true, amountPaid: true, balance: true, deliveredAt: true, deliveredOverride: true,
      customer: { select: { name: true, balanceHidden: true } },
      items: { select: { description: true, quantity: true } },
    },
  });
  // Who released it: the audit line written when the order was marked delivered.
  const logs = orders.length
    ? await prisma.auditLog.findMany({
      where: { entity: 'Order', entityId: { in: orders.map((o) => String(o.id)) }, OR: [{ summary: { contains: 'marked Delivered' } }, { summary: { contains: 'released with unpaid balance' } }] },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, user: { select: { name: true } } },
    })
    : [];
  const releasedBy = new Map<string, string>();
  for (const l of logs) if (!releasedBy.has(l.entityId)) releasedBy.set(l.entityId, l.user?.name ?? '—');
  const hide = (o: (typeof orders)[number]) => o.customer.balanceHidden && !user.isAdmin;

  return (
    <div>
      <PageHeader title="Deliveries & pickups" subtitle={`${orders.length} order${orders.length === 1 ? '' : 's'} released ${from === to ? `on ${from}` : `from ${from} to ${to}`}`} />
      <DeliveryTabs active="released" />
      <Card>
        <FilterBar>
          <input name="q" defaultValue={q} placeholder="Order no. or customer" className="input w-56" />
          <label className="text-xs text-slate-600">Released from<input type="date" name="from" defaultValue={from} className="input w-auto" /></label>
          <label className="text-xs text-slate-600">to<input type="date" name="to" defaultValue={to} className="input w-auto" /></label>
        </FilterBar>
        {orders.length === 0 ? <Empty>No orders were released in this period.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Released</th><th>Order no.</th><th>Customer</th><th>Items</th><th>Released by</th><th className="text-right">Total</th><th className="text-right">Paid</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(o.deliveredAt)}</td>
                    <td><Link href={`/orders/${o.id}`} className="link">{o.orderNo}</Link></td>
                    <td>{o.customer.name}</td>
                    <td className="max-w-[18rem] text-xs text-slate-600">{o.items.map((i) => `${i.quantity} × ${i.description}`).join(', ')}</td>
                    <td className="whitespace-nowrap">{releasedBy.get(String(o.id)) ?? '—'}</td>
                    <td className="text-right">{peso(o.total)}</td>
                    <td className="whitespace-nowrap text-right">
                      {hide(o) ? <span className="text-slate-400">Hidden</span> : o.balance > 0
                        ? <span className="text-red-600">{peso(o.amountPaid)}<div className="text-[11px]">owes {peso(o.balance)}</div></span>
                        : <span className="text-emerald-700">{peso(o.amountPaid)}</span>}
                      {o.deliveredOverride && <div className="mt-0.5"><Badge tone="amber">Released unpaid (owner override)</Badge></div>}
                    </td>
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
