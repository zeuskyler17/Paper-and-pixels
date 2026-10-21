import Link from 'next/link';
import type { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, isOverdue, manilaDayRange, parseDateInput } from '@/lib/dates';
import { ORDER_STATUS, PAYMENT_STATUS, options } from '@/lib/labels';
import { Card, Empty, FilterBar, PageHeader, StatusBadge, TableWrap, Badge } from '@/components/ui';

export const metadata = { title: 'Orders' };

type SP = Promise<{ q?: string; status?: string; pay?: string; from?: string; to?: string }>;

const UNFINISHED: OrderStatus[] = ['PENDING', 'IN_PRODUCTION'];

export default async function OrdersPage({ searchParams }: { searchParams: SP }) {
  await requireUser('orders');
  const { q = '', status = '', pay = '', from = '', to = '' } = await searchParams;

  const where: Prisma.OrderWhereInput = {};
  if (q) {
    where.OR = [
      { orderNo: { contains: q, mode: 'insensitive' } },
      { customer: { name: { contains: q, mode: 'insensitive' } } },
      { customer: { mobile: { contains: q } } },
    ];
  }
  if (status === 'OPEN') where.status = { in: UNFINISHED };
  else if (status === 'OVERDUE') {
    where.status = { in: UNFINISHED };
    where.targetDate = { lt: manilaDayRange().start };
  } else if (status in ORDER_STATUS) where.status = status as OrderStatus;
  if (pay in PAYMENT_STATUS) where.paymentStatus = pay as PaymentStatus;
  if (pay === 'OWING') where.balance = { gt: 0 };
  const createdAt: Prisma.DateTimeFilter = {};
  if (parseDateInput(from)) createdAt.gte = manilaDayRange(from).start;
  if (parseDateInput(to)) createdAt.lt = manilaDayRange(to).end;
  if (createdAt.gte || createdAt.lt) where.createdAt = createdAt;

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { customer: { select: { id: true, name: true, isInternal: true } } },
  });
  const totals = orders.filter((o) => o.status !== 'CANCELLED').reduce((a, o) => ({ total: a.total + o.total, balance: a.balance + o.balance }), { total: 0, balance: 0 });

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle={`${orders.length}${orders.length === 300 ? '+' : ''} orders · ${peso(totals.total)} billed · ${peso(totals.balance)} unpaid`}
        actions={<Link href="/orders/new" className="btn-primary">+ New order</Link>}
      />
      <Card>
        <FilterBar>
          <input name="q" defaultValue={q} placeholder="Order no. or customer" className="input w-56" />
          <select name="status" defaultValue={status} className="input w-auto">
            <option value="">All statuses</option>
            <option value="OPEN">Open (pending + in production)</option>
            <option value="OVERDUE">Overdue</option>
            {options(ORDER_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select name="pay" defaultValue={pay} className="input w-auto">
            <option value="">All payments</option>
            <option value="OWING">With balance</option>
            {options(PAYMENT_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label className="text-xs text-slate-500">From<input type="date" name="from" defaultValue={from} className="input w-auto" /></label>
          <label className="text-xs text-slate-500">To<input type="date" name="to" defaultValue={to} className="input w-auto" /></label>
        </FilterBar>
        {orders.length === 0 ? <Empty>No orders found.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Order no.</th><th>Date</th><th>Customer</th><th>Status</th><th>Payment</th>
                  <th className="text-right">Total</th><th className="text-right">Balance</th><th>Target date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const overdue = UNFINISHED.includes(o.status) && isOverdue(o.targetDate);
                  return (
                    <tr key={o.id} className={overdue ? 'bg-red-50/60' : ''}>
                      <td><Link href={`/orders/${o.id}`} className="link whitespace-nowrap">{o.orderNo}</Link></td>
                      <td className="whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                      <td><Link href={`/customers/${o.customer.id}`} className="hover:underline">{o.customer.name}</Link>{o.customer.isInternal && <span className="ml-1"><Badge tone="amber">Transfer</Badge></span>}</td>
                      <td><StatusBadge value={o.status} labels={ORDER_STATUS} /></td>
                      <td><StatusBadge value={o.paymentStatus} labels={PAYMENT_STATUS} /></td>
                      <td className="text-right whitespace-nowrap">{peso(o.total)}</td>
                      <td className={`text-right whitespace-nowrap font-medium ${o.balance > 0 ? 'text-red-600' : 'text-slate-500'}`}>{peso(o.balance)}</td>
                      <td className={`whitespace-nowrap ${overdue ? 'font-semibold text-red-600' : ''}`}>{fmtDate(o.targetDate)}{overdue && ' · overdue'}</td>
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
