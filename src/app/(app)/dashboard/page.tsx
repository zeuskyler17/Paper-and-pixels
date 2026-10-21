import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser, can } from '@/lib/auth';
import { customerBalances } from '@/lib/orders';
import { fmtQty, peso } from '@/lib/money';
import { daysBetween, fmtDate, manilaDayRange, startOfMonthManila } from '@/lib/dates';
import { JOB_STATUS, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '@/lib/labels';
import { Card, Empty, PageHeader, Stat, StatusBadge, TableWrap } from '@/components/ui';
import { monthlyPnl } from './_pnl';
import { PnlChart } from './PnlChart';
import { punchFlags } from '@/lib/clockFlags';
import { fmtRolls, isRoll } from '@/lib/rolls';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ pnl?: string }> }) {
  const user = await requireUser('dashboard');
  const admin = can(user, 'dashboard_money'); // money tiles: receivables, sales vs expenses; P&L chart
  const { pnl } = await searchParams;
  const pnlSpan = [6, 12, 24].includes(Number(pnl)) ? Number(pnl) : 12;
  const pnlMonths = admin ? await monthlyPnl(pnlSpan) : [];
  // Time-clock punches to check today (buddy punching) — owner / admin only.
  const clockAlerts = admin ? await (async () => {
    const entries = await prisma.timeEntry.findMany({ where: { workDate: manilaDayRange().start }, include: { employee: { select: { firstName: true, lastName: true } } } });
    const f = await punchFlags(entries);
    return entries.filter((e) => f.has(e.id) && !f.get(e.id)!.cleared).map((e) => ({ id: e.id, name: `${e.employee.firstName} ${e.employee.lastName}`, reasons: [...(f.get(e.id)!.in.map((r) => `In: ${r}`)), ...(f.get(e.id)!.out.map((r) => `Out: ${r}`))] }));
  })() : [];
  const today = manilaDayRange();
  const monthStart = manilaDayRange(startOfMonthManila()).start;
  const openJob = { status: { notIn: ['COMPLETED', 'CANCELLED'] as ('COMPLETED' | 'CANCELLED')[] } };

  const [
    salesToday, ordersToday, cashByMethod, pendingOrders, jobsInProcess, jobsInQc, overdueCount, overdueJobs,
    receivables, lowStock, recentOrders, balances, monthSales, monthExpenses, completedJobs,
  ] = await Promise.all([
    prisma.order.aggregate({ where: { status: { not: 'CANCELLED' }, customer: { isInternal: false }, createdAt: { gte: today.start, lt: today.end } }, _sum: { total: true } }),
    prisma.order.count({ where: { status: { not: 'CANCELLED' }, customer: { isInternal: false }, createdAt: { gte: today.start, lt: today.end } } }),
    prisma.payment.groupBy({ by: ['method'], where: { voided: false, paidAt: { gte: today.start, lt: today.end } }, _sum: { amount: true }, _count: true }),
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.job.count({ where: { status: 'IN_PROCESS' } }),
    prisma.job.count({ where: { status: 'QUALITY_CHECK' } }),
    prisma.job.count({ where: { ...openJob, dueDate: { lt: today.start } } }),
    prisma.job.findMany({
      where: { ...openJob, dueDate: { lt: today.start } },
      orderBy: { dueDate: 'asc' },
      take: 10,
      include: {
        order: { select: { id: true, orderNo: true, customer: { select: { name: true } } } },
        orderItem: { select: { description: true } },
        assignedTo: { select: { name: true } },
      },
    }),
    // Total receivables tile: owners/admins only.
    admin ? prisma.order.aggregate({ where: { status: { not: 'CANCELLED' } }, _sum: { balance: true } }) : Promise.resolve(null),
    prisma.material.findMany({
      where: { active: true, stock: { lte: prisma.material.fields.reorderLevel } },
      orderBy: { name: 'asc' },
      take: 50,
      select: { id: true, name: true, unit: true, stock: true, reorderLevel: true, rollLengthM: true },
    }),
    prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { customer: { select: { name: true } } } }),
    customerBalances(),
    admin
      ? prisma.order.aggregate({ where: { status: { not: 'CANCELLED' }, customer: { isInternal: false }, createdAt: { gte: monthStart } }, _sum: { total: true } })
      : Promise.resolve(null),
    admin
      ? prisma.expense.aggregate({ where: { voided: false, date: { gte: monthStart } }, _sum: { amount: true } })
      : Promise.resolve(null),
    // Finished jobs whose order has not been released yet (ready for pickup / delivery).
    prisma.job.findMany({
      where: { status: 'COMPLETED', order: { status: { notIn: ['DELIVERED', 'CANCELLED'] } } },
      orderBy: { completedAt: 'desc' },
      take: 15,
      include: {
        order: { select: { id: true, orderNo: true, balance: true, customer: { select: { name: true } } } },
        orderItem: { select: { description: true, quantity: true } },
        assignedTo: { select: { name: true } },
      },
    }),
  ]);

  const cashToday = cashByMethod.reduce((s, r) => s + (r._sum.amount ?? 0), 0);
  const topOwing = [...balances.entries()].filter(([, b]) => b.balance > 0).sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
  const owingCustomers = topOwing.length
    ? await prisma.customer.findMany({ where: { id: { in: topOwing.map(([id]) => id) } }, select: { id: true, name: true, mobile: true } })
    : [];
  const custById = new Map(owingCustomers.map((c) => [c.id, c]));
  const sales = monthSales?._sum.total ?? 0;
  const expenses = monthExpenses?._sum.amount ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Operations overview"
        subtitle={`Live figures for ${fmtDate(new Date())} · signed in as ${user.name}`}
        actions={
          <>
            <Link href="/orders/new" className="btn-primary">+ New order</Link>
            <Link href="/customers/new" className="btn-secondary">+ New customer</Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today's sales" value={peso(salesToday._sum.total)} hint={`${ordersToday} order${ordersToday === 1 ? '' : 's'}`} href="/orders" />
        <Stat
          label="Collected today"
          value={peso(cashToday)}
          tone="green"
          hint={cashByMethod.length === 0 ? 'No payments yet' : cashByMethod.map((r) => `${PAYMENT_METHOD[r.method]} ${peso(r._sum.amount)}`).join(' · ')}
        />
        {admin && receivables && (
          <Stat label="Total receivables" value={peso(receivables._sum.balance)} tone={(receivables._sum.balance ?? 0) > 0 ? 'red' : undefined} href="/customers?owing=1" />
        )}
        <Stat label="Pending orders" value={pendingOrders} href="/orders?status=PENDING" />
        <Stat label="Jobs in process" value={jobsInProcess} hint={jobsInQc ? `+ ${jobsInQc} in quality check` : undefined} href="/jobs" />
        <Stat label="Overdue jobs" value={overdueCount} tone={overdueCount > 0 ? 'red' : 'green'} href="/jobs" />
        <Stat label="Low-stock items" value={lowStock.length} tone={lowStock.length > 0 ? 'amber' : 'green'} href="/inventory?low=1" />
        {admin && (
          <Stat
            label="This month: sales vs expenses"
            value={<span className="text-lg">{peso(sales)} <span className="text-slate-400">/</span> {peso(expenses)}</span>}
            hint={<span className={sales - expenses >= 0 ? 'text-emerald-700' : 'text-red-700'}>Net {peso(sales - expenses)}</span>}
            href="/reports"
          />
        )}
      </div>

      {admin && clockAlerts.length > 0 && (
        <Card title={`⚠ Time clock: ${clockAlerts.length} punch${clockAlerts.length === 1 ? '' : 'es'} to check today`} actions={<Link href="/timekeeping" className="link text-xs">Timekeeping</Link>}>
          <ul className="space-y-1 text-sm">
            {clockAlerts.map((a) => <li key={a.id}><span className="font-semibold">{a.name}</span> — {a.reasons.join(' · ')}</li>)}
          </ul>
          <p className="mt-2 text-[12px] text-slate-500">Someone timed in/out while another employee's login was active, or one device punched for several people within minutes. Check the selfies in Timekeeping.</p>
        </Card>
      )}
      {admin && <PnlChart months={pnlMonths} span={pnlSpan} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Customers with unpaid balance" actions={<Link href="/customers?owing=1" className="link text-xs">View all</Link>}>
          {topOwing.length === 0 ? <Empty>No unpaid balances.</Empty> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Customer</th><th>Last order</th><th className="text-right">Balance</th></tr></thead>
                <tbody>
                  {topOwing.map(([id, b]) => {
                    const c = custById.get(id);
                    return (
                      <tr key={id}>
                        <td>
                          <Link href={`/customers/${id}`} className="link">{c?.name ?? `Customer #${id}`}</Link>
                          {c?.mobile && <div className="text-xs text-slate-500">{c.mobile}</div>}
                        </td>
                        <td className="whitespace-nowrap">{fmtDate(b.lastOrder)}</td>
                        <td className="text-right font-semibold text-red-600 whitespace-nowrap">{peso(b.balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title="Overdue jobs" actions={<Link href="/jobs" className="link text-xs">Production board</Link>}>
          {overdueJobs.length === 0 ? <Empty>No overdue jobs.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {overdueJobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <Link href={`/jobs/${j.id}`} className="link">{j.orderItem.description}</Link>
                    <div className="text-xs text-slate-500">
                      <Link href={`/orders/${j.order.id}`} className="hover:underline">{j.order.orderNo}</Link> · {j.order.customer.name} · {j.assignedTo?.name ?? 'Unassigned'}
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge value={j.status} labels={JOB_STATUS} />
                    <div className="text-xs font-medium text-red-600">
                      due {fmtDate(j.dueDate)} ({j.dueDate ? Math.max(1, daysBetween(j.dueDate, today.start)) : 0}d late)
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={`Completed jobs — ready for pickup / delivery (${completedJobs.length}${completedJobs.length === 15 ? '+' : ''})`}
          actions={<Link href="/jobs" className="link text-xs">Production board</Link>}
        >
          {completedJobs.length === 0 ? <Empty>No finished jobs waiting for release.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {completedJobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <Link href={`/jobs/${j.id}`} className="link">{j.orderItem.description}</Link>
                    <span className="text-slate-500"> × {j.orderItem.quantity}</span>
                    <div className="text-xs text-slate-500">
                      <Link href={`/orders/${j.order.id}`} className="hover:underline">{j.order.orderNo}</Link> · {j.order.customer.name} · {j.assignedTo?.name ?? 'Unassigned'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">done {fmtDate(j.completedAt)}</div>
                    {j.order.balance > 0
                      ? <div className="text-xs font-medium text-red-600">balance {peso(j.order.balance)}</div>
                      : <div className="text-xs font-medium text-emerald-600">paid</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Low stock" actions={<Link href="/inventory" className="link text-xs">Inventory</Link>}>
          {lowStock.length === 0 ? <Empty>All materials are above their reorder level.</Empty> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Material</th><th className="text-right">Stock</th><th className="text-right">Reorder at</th></tr></thead>
                <tbody>
                  {lowStock.map((m) => (
                    <tr key={m.id}>
                      <td><Link href={`/inventory/${m.id}`} className="link">{m.name}</Link></td>
                      <td className={`text-right whitespace-nowrap ${m.stock <= 0 ? 'font-semibold text-red-600' : 'text-amber-700'}`}>{isRoll(m) ? fmtRolls(m.stock, m) : `${fmtQty(m.stock)} ${m.unit}`}</td>
                      <td className="text-right whitespace-nowrap text-slate-500">{isRoll(m) ? fmtRolls(m.reorderLevel, m) : `${fmtQty(m.reorderLevel)} ${m.unit}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title="Recent orders" actions={<Link href="/orders" className="link text-xs">All orders</Link>}>
          {recentOrders.length === 0 ? <Empty>No orders yet.</Empty> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {recentOrders.map((o) => (
                    <tr key={o.id}>
                      <td className="whitespace-nowrap">
                        <Link href={`/orders/${o.id}`} className="link">{o.orderNo}</Link>
                        <div className="text-xs text-slate-500">{fmtDate(o.createdAt)}</div>
                      </td>
                      <td>{o.customer.name}</td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge value={o.status} labels={ORDER_STATUS} />
                          <StatusBadge value={o.paymentStatus} labels={PAYMENT_STATUS} />
                        </div>
                      </td>
                      <td className="text-right whitespace-nowrap">{peso(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </div>
  );
}
