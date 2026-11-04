import Link from 'next/link';
import { prisma } from '@/lib/db';
import { jobTitle } from '@/lib/printJob';
import { requireUser, can } from '@/lib/auth';
import { ReleaseOrderButton } from '@/components/ReleaseOrderButton';
import { customerBalances } from '@/lib/orders';
import { fmtQty, peso } from '@/lib/money';
import { daysBetween, fmtDate, manilaDayRange, startOfMonthManila } from '@/lib/dates';
import { JOB_STATUS, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '@/lib/labels';
import { Card, Empty, Stat, StatusBadge, TableWrap } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icons';
import { ShowMore } from '@/components/ShowMore';
import { monthlyPnl } from './_pnl';
import { PnlChart } from './PnlChart';
import { punchFlags } from '@/lib/clockFlags';
import { fmtRolls, isRoll } from '@/lib/rolls';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/** Compact secondary metric: icon, label, figure — one row of four under the headline tiles. */
function MiniStat({ label, value, hint, href, icon, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href: string; icon: IconName; tone?: 'red' | 'amber' | 'green' }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-500';
  return (
    <Link href={href} className="card group flex items-center gap-3 px-3.5 py-3 transition duration-200 hover:border-slate-300">
      <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-50 ring-1 ring-inset ring-slate-200 ${color}`}><Icon name={icon} className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10.5px] font-semibold uppercase tracking-[0.09em] text-slate-500">{label}</span>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[19px] font-semibold leading-tight tabular-nums text-slate-900">{value}</span>
          {hint && <span className="truncate text-[11.5px] text-slate-500">{hint}</span>}
        </span>
      </span>
      <Icon name="chevron" className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
    </Link>
  );
}

/** Horizontal share bar (payment methods, month spend vs sales). */
function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${className}`} style={{ width: `${pct}%` }} /></div>;
}

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
        orderItem: { select: { description: true, quantity: true, specs: { select: { name: true, value: true } } } },
        assignedTo: { select: { name: true } }, helpers: { select: { user: { select: { name: true } } } },
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
        order: { select: { id: true, orderNo: true, balance: true, customerId: true, customer: { select: { name: true } }, jobs: { select: { status: true } } } },
        orderItem: { select: { description: true, quantity: true, specs: { select: { name: true, value: true } } } },
        assignedTo: { select: { name: true } }, helpers: { select: { user: { select: { name: true } } } },
      },
    }),
  ]);

  // Money received today: order payments (not those drawn from an advance payment) plus advance payments received.
  const depositsToday = await prisma.customerDeposit.groupBy({ by: ['method'], where: { voided: false, receivedAt: { gte: today.start, lt: today.end } }, _sum: { amount: true } });
  const collected = new Map<string, number>();
  for (const r of cashByMethod) if (r.method !== 'ADVANCE') collected.set(r.method, (collected.get(r.method) ?? 0) + (r._sum.amount ?? 0));
  for (const r of depositsToday) collected.set(r.method, (collected.get(r.method) ?? 0) + (r._sum.amount ?? 0));
  const cashToday = [...collected.values()].reduce((s, v) => s + v, 0);
  const fromAdvance = cashByMethod.find((r) => r.method === 'ADVANCE')?._sum.amount ?? 0;
  // Customers whose balance the owner hid are left out for non-admin logins.
  const hiddenIds = user.isAdmin ? new Set<number>() : new Set((await prisma.customer.findMany({ where: { balanceHidden: true }, select: { id: true } })).map((c) => c.id));
  const topOwing = [...balances.entries()].filter(([id, b]) => b.balance > 0 && !hiddenIds.has(id)).sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
  const owingCustomers = topOwing.length
    ? await prisma.customer.findMany({ where: { id: { in: topOwing.map(([id]) => id) } }, select: { id: true, name: true, mobile: true } })
    : [];
  const custById = new Map(owingCustomers.map((c) => [c.id, c]));
  const sales = monthSales?._sum.total ?? 0;
  const expenses = monthExpenses?._sum.amount ?? 0;

  const hour = Number(new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = user.name.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || user.name;
  const methods = [...collected].sort((a, b) => b[1] - a[1]);
  const net = sales - expenses;
  const releaseCount = `${completedJobs.length}${completedJobs.length === 15 ? '+' : ''}`;
  const people = (j: { assignedTo: { name: string } | null; helpers: { user: { name: string } }[] }) => (j.assignedTo ? [j.assignedTo.name, ...j.helpers.map((h) => h.user.name)].join(', ') : 'Unassigned');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" /> Live · {fmtDate(new Date())}
          </div>
          <h1 className="mt-1.5 text-[24px] font-semibold leading-tight tracking-tight sm:text-[26px]">{greeting}, {firstName}</h1>
          <p className="mt-0.5 text-[13px] text-slate-600">Here is how the shop is doing today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/orders/new" className="btn-primary h-10 px-4"><Icon name="plus" className="h-4 w-4" /> New order</Link>
          <Link href="/customers/new" className="btn-secondary h-10 px-4"><Icon name="customers" className="h-4 w-4" /> New customer</Link>
        </div>
      </div>

      {/* Headline figures */}
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <Stat label="Today's sales" icon="receipt" value={peso(salesToday._sum.total)} hint={`${ordersToday} order${ordersToday === 1 ? '' : 's'} today`} href="/orders" />
        <Stat
          label="Collected today" icon="cash" tone="green" value={peso(cashToday)}
          hint={collected.size === 0 ? (fromAdvance ? `No new money · ${peso(fromAdvance)} from advance payments` : 'No payments yet') : `${collected.size} payment method${collected.size === 1 ? '' : 's'}${fromAdvance ? ` · ${peso(fromAdvance)} from advance payments (not new money)` : ''}`}
        />
        {admin && receivables ? (
          <Stat label="Total receivables" icon="wallet" value={peso(receivables._sum.balance)} tone={(receivables._sum.balance ?? 0) > 0 ? 'red' : 'green'} hint="Unpaid balances, all orders" href="/customers?owing=1" />
        ) : (
          <Stat label="Pending orders" icon="orders" value={pendingOrders} hint="Waiting to start" href="/orders?status=PENDING" />
        )}
        <Stat label="Overdue jobs" icon="alert" value={overdueCount} tone={overdueCount > 0 ? 'red' : 'green'} hint={overdueCount > 0 ? 'Past their due date' : 'Everything on schedule'} href="/jobs" />
      </div>

      {/* Secondary figures */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {admin && receivables && <MiniStat label="Pending orders" icon="orders" value={pendingOrders} href="/orders?status=PENDING" />}
        <MiniStat label="Jobs in process" icon="board" value={jobsInProcess} hint={jobsInQc ? `+ ${jobsInQc} in QC` : undefined} href="/jobs" />
        <MiniStat label="Ready for release" icon="truck" value={releaseCount} tone={completedJobs.length ? 'green' : undefined} href="/jobs" />
        <MiniStat label="Low-stock items" icon="boxes" value={lowStock.length} tone={lowStock.length > 0 ? 'amber' : 'green'} href="/inventory?low=1" />
        {!(admin && receivables) && <MiniStat label="Customers owing" icon="customers" value={topOwing.length} href="/customers?owing=1" />}
      </div>

      {admin && clockAlerts.length > 0 && (
        <div className="card flex gap-3 border-amber-300 bg-amber-50 px-4 py-3">
          <span aria-hidden className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-amber-100 text-amber-700"><Icon name="clock" className="h-[17px] w-[17px]" /></span>
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-amber-900">Time clock: {clockAlerts.length} punch{clockAlerts.length === 1 ? '' : 'es'} to check today</div>
              <Link href="/timekeeping" className="link text-xs">Open timekeeping</Link>
            </div>
            <ul className="mt-1 space-y-0.5 text-slate-700">
              {clockAlerts.map((a) => <li key={a.id}><span className="font-semibold">{a.name}</span> — {a.reasons.join(' · ')}</li>)}
            </ul>
            <p className="mt-1.5 text-[12px] text-slate-500">Someone timed in/out while another employee&apos;s login was active, or one device punched for several people within minutes. Check the selfies in Timekeeping.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Main column */}
        <div className="min-w-0 space-y-4 xl:col-span-2">
          {admin && <PnlChart months={pnlMonths} span={pnlSpan} />}

          <Card
            title={`Ready for pickup / delivery (${releaseCount})`}
            actions={<Link href="/jobs" className="link text-xs">Production board</Link>}
          >
            {completedJobs.length === 0 ? <Empty>No finished jobs waiting for release.</Empty> : (
              <ShowMore count={completedJobs.length} noun="jobs"><ul className="limit-list -my-1 divide-y divide-slate-100 text-sm">
                {completedJobs.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/jobs/${j.id}`} className="link">{jobTitle(j.kind, j.orderItem)}</Link>
                      <span className="text-slate-500"> × {j.orderItem.quantity}</span>
                      <div className="text-xs text-slate-500">
                        <Link href={`/orders/${j.order.id}`} className="font-mono hover:underline">{j.order.orderNo}</Link> · {j.order.customer.name} · {people(j)} · done {fmtDate(j.completedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {j.order.balance > 0 && hiddenIds.has(j.order.customerId)
                        ? null
                        : j.order.balance > 0
                        ? <span className="text-xs font-semibold text-red-600">Balance {peso(j.order.balance)}</span>
                        : <span className="text-xs font-semibold text-emerald-600">Paid</span>}
                      {can(user, 'orders') && (
                        <ReleaseOrderButton orderId={j.order.id} orderNo={j.order.orderNo} balance={j.order.balance} hideAmount={hiddenIds.has(j.order.customerId)}
                          ready={j.order.jobs.every((x) => x.status === 'COMPLETED' || x.status === 'CANCELLED')} className="flex justify-end" />
                      )}
                    </div>
                  </li>
                ))}
              </ul></ShowMore>
            )}
          </Card>

          <Card title="Recent orders" actions={<Link href="/orders" className="link text-xs">All orders</Link>}>
            {recentOrders.length === 0 ? <Empty>No orders yet.</Empty> : (
              <ShowMore count={recentOrders.length} noun="orders"><TableWrap>
                <table className="table">
                  <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="text-right">Total</th></tr></thead>
                  <tbody className="limit-list">
                    {recentOrders.map((o) => (
                      <tr key={o.id}>
                        <td className="whitespace-nowrap">
                          <Link href={`/orders/${o.id}`} className="link font-mono">{o.orderNo}</Link>
                          <div className="text-xs text-slate-500">{fmtDate(o.createdAt)}</div>
                        </td>
                        <td>{o.customer.name}</td>
                        <td>
                          <div className="flex flex-wrap items-start gap-1">
                            <StatusBadge value={o.status} labels={ORDER_STATUS} />
                            <StatusBadge value={o.paymentStatus} labels={PAYMENT_STATUS} />
                          </div>
                        </td>
                        <td className="text-right whitespace-nowrap font-semibold">{peso(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap></ShowMore>
            )}
          </Card>
        </div>

        {/* Side column (two across on mid-size screens, one column beside the main column on wide screens) */}
        <div className="grid min-w-0 content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
          <Card title="Today at the counter">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="label mb-0.5">Sales</div>
                <div className="font-mono text-[20px] font-semibold tabular-nums">{peso(salesToday._sum.total)}</div>
                <div className="text-[11.5px] text-slate-500">{ordersToday} order{ordersToday === 1 ? '' : 's'}</div>
              </div>
              <div>
                <div className="label mb-0.5">Collected</div>
                <div className="font-mono text-[20px] font-semibold tabular-nums text-emerald-700">{peso(cashToday)}</div>
                <div className="text-[11.5px] text-slate-500">new money received</div>
              </div>
            </div>
            <div className="mt-4 space-y-2.5">
              {methods.length === 0 ? <p className="text-[12.5px] text-slate-500">No payments received yet today.</p> : methods.map(([m, amt]) => (
                <div key={m}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                    <span className="font-medium text-slate-700">{PAYMENT_METHOD[m] ?? m}</span>
                    <span className="font-mono tabular-nums text-slate-900">{peso(amt)}</span>
                  </div>
                  <Bar value={amt} max={cashToday} className="bg-emerald-500" />
                </div>
              ))}
              {fromAdvance > 0 && <p className="text-[11.5px] text-slate-500">Plus {peso(fromAdvance)} applied from advance payments (money received earlier, not counted again).</p>}
            </div>
            <Link href="/reports" className="link mt-4 inline-block text-xs">Daily report</Link>
          </Card>

          {admin && (
            <Card title="This month" actions={<Link href="/reports" className="link text-xs">Reports</Link>}>
              <div className="space-y-3 text-[13px]">
                <div>
                  <div className="mb-1 flex items-baseline justify-between"><span className="text-slate-600">Sales</span><span className="font-mono font-semibold tabular-nums">{peso(sales)}</span></div>
                  <Bar value={sales} max={Math.max(sales, expenses)} className="bg-brand-500" />
                </div>
                <div>
                  <div className="mb-1 flex items-baseline justify-between"><span className="text-slate-600">Expenses</span><span className="font-mono font-semibold tabular-nums">{peso(expenses)}</span></div>
                  <Bar value={expenses} max={Math.max(sales, expenses)} className="bg-red-500" />
                </div>
                <div className="flex items-baseline justify-between border-t border-slate-200 pt-2.5">
                  <span className="font-semibold text-slate-700">Net</span>
                  <span className={`font-mono text-[17px] font-semibold tabular-nums ${net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{peso(net)}</span>
                </div>
              </div>
            </Card>
          )}

          <Card title="Overdue jobs" actions={<Link href="/jobs" className="link text-xs">Board</Link>}>
            {overdueJobs.length === 0 ? <Empty>No overdue jobs.</Empty> : (
              <ShowMore count={overdueJobs.length} noun="jobs"><ul className="limit-list -my-1 divide-y divide-slate-100 text-sm">
                {overdueJobs.map((j) => (
                  <li key={j.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/jobs/${j.id}`} className="link min-w-0">{jobTitle(j.kind, j.orderItem)}</Link>
                      <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-200">
                        {j.dueDate ? Math.max(1, daysBetween(j.dueDate, today.start)) : 0}d late
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      <Link href={`/orders/${j.order.id}`} className="font-mono hover:underline">{j.order.orderNo}</Link> · {j.order.customer.name} · {people(j)}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500"><StatusBadge value={j.status} labels={JOB_STATUS} /> due {fmtDate(j.dueDate)}</div>
                  </li>
                ))}
              </ul></ShowMore>
            )}
          </Card>

          <Card title="Low stock" actions={<Link href="/inventory" className="link text-xs">Inventory</Link>}>
            {lowStock.length === 0 ? <Empty>All materials are above their reorder level.</Empty> : (
              <ShowMore count={lowStock.length} noun="materials"><ul className="limit-list -my-1 divide-y divide-slate-100 text-[13px]">
                {lowStock.map((m) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-3 py-2">
                    <Link href={`/inventory/${m.id}`} className="link min-w-0 truncate">{m.name}</Link>
                    <span className="shrink-0 text-right">
                      <span className={`font-mono tabular-nums ${m.stock <= 0 ? 'font-semibold text-red-600' : 'text-amber-700'}`}>{isRoll(m) ? fmtRolls(m.stock, m) : `${fmtQty(m.stock)} ${m.unit}`}</span>
                      <span className="block text-[11px] text-slate-500">reorder at {isRoll(m) ? fmtRolls(m.reorderLevel, m) : `${fmtQty(m.reorderLevel)} ${m.unit}`}</span>
                    </span>
                  </li>
                ))}
              </ul></ShowMore>
            )}
          </Card>

          <Card title="Unpaid balances" actions={<Link href="/customers?owing=1" className="link text-xs">View all</Link>}>
            {topOwing.length === 0 ? <Empty>No unpaid balances.</Empty> : (
              <ShowMore count={topOwing.length} noun="customers"><ul className="limit-list -my-1 divide-y divide-slate-100 text-[13px]">
                {topOwing.map(([id, b]) => {
                  const c = custById.get(id);
                  return (
                    <li key={id} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <Link href={`/customers/${id}`} className="link block truncate">{c?.name ?? `Customer #${id}`}</Link>
                        <span className="text-[11px] text-slate-500">{c?.mobile ? `${c.mobile} · ` : ''}last order {fmtDate(b.lastOrder)}</span>
                      </span>
                      <span className="shrink-0 font-mono font-semibold tabular-nums text-red-600">{peso(b.balance)}</span>
                    </li>
                  );
                })}
              </ul></ShowMore>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
