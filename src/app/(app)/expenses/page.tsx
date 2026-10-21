import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser, can } from '@/lib/auth';
import { peso } from '@/lib/money';
import { addDays, fmtDate, manilaRange, parseDateInput, startOfMonthManila, todayManila } from '@/lib/dates';
import { PAYMENT_METHOD } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Empty, FilterBar, PageHeader, Stat, TableWrap } from '@/components/ui';
import { voidExpense } from './actions';

export const metadata = { title: 'Expenses' };

type SP = Promise<{ view?: string; date?: string; from?: string; to?: string; category?: string }>;

export default async function ExpensesPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser('expenses');
  const sp = await searchParams;
  // Two tabs: "Daily" (one day, with prev / next) and "Date range" (default, as before).
  const daily = sp.view === 'day';
  const day = parseDateInput(sp.date) ? sp.date! : todayManila();
  const from = daily ? day : parseDateInput(sp.from) ? sp.from! : startOfMonthManila();
  const to = daily ? day : parseDateInput(sp.to) ? sp.to! : todayManila();
  const categoryId = Number(sp.category) || null;
  const { start, end } = manilaRange(from, to);

  const where: Prisma.ExpenseWhereInput = { date: { gte: start, lt: end }, ...(categoryId ? { categoryId } : {}) };
  const [expenses, categories] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: { category: true, createdBy: { select: { name: true } }, attachment: { select: { id: true, mimeType: true, filename: true } } },
    }),
    prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const valid = expenses.filter((e) => !e.voided);
  const total = valid.reduce((s, e) => s + e.amount, 0);
  const byCategory = new Map<string, { amount: number; count: number }>();
  for (const e of valid) {
    const g = byCategory.get(e.category.name) ?? { amount: 0, count: 0 };
    g.amount += e.amount;
    g.count += 1;
    byCategory.set(e.category.name, g);
  }
  const subtotals = [...byCategory.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const isAdmin = can(user, 'expenses_manage'); // void expenses, manage categories
  const cashPaid = valid.filter((e) => e.paidVia === 'CASH').reduce((s, e) => s + e.amount, 0);
  const dayLabel = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(parseDateInput(day)!);
  const cat = categoryId ? `&category=${categoryId}` : '';
  const dayHref = (d: string) => `/expenses?view=day&date=${d}${cat}`;
  const isToday = day === todayManila();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Expenses"
        subtitle={daily ? dayLabel : `${fmtDate(start)} – ${fmtDate(parseDateInput(to))}`}
        actions={
          <>
            {isAdmin && <Link href="/expenses/categories" className="btn-secondary">Categories</Link>}
            <Link href="/expenses/new" className="btn-primary">+ Add expense</Link>
          </>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {[
          { label: 'Daily', href: `/expenses?view=day&date=${daily ? day : todayManila()}${cat}`, on: daily },
          { label: 'Date range', href: `/expenses${categoryId ? `?category=${categoryId}` : ''}`, on: !daily },
        ].map((t) => (
          <Link key={t.label} href={t.href}
            className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-semibold ${t.on ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {daily && (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={dayHref(addDays(day, -1))} className="btn-secondary btn-sm">← Previous day</Link>
          {!isToday && <Link href={dayHref(todayManila())} className="btn-secondary btn-sm">Today</Link>}
          <Link href={dayHref(addDays(day, 1))} className="btn-secondary btn-sm">Next day →</Link>
          <span className="ml-1 text-[14px] font-semibold">{dayLabel}</span>
          {isToday && <span className="text-[12px] font-semibold uppercase tracking-wide text-brand-700">Today</span>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={daily ? 'Total for the day' : 'Total (filtered)'} value={peso(total)} tone={daily && total > 0 ? 'red' : undefined} />
        <Stat label="Entries" value={valid.length} hint={expenses.length > valid.length ? `${expenses.length - valid.length} voided` : undefined} />
        {daily && <Stat label="Paid in cash" value={peso(cashPaid)} hint="Taken from the cash drawer" />}
        {daily && <Stat label="Paid by GCash / bank / other" value={peso(total - cashPaid)} />}
      </div>

      <Card>
        <FilterBar>
          {daily ? (
            <>
              <input type="hidden" name="view" value="day" />
              <label><span className="label">Day</span><input type="date" name="date" defaultValue={day} className="input w-auto" /></label>
            </>
          ) : (
            <>
              <label><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input w-auto" /></label>
              <label><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input w-auto" /></label>
            </>
          )}
          <label>
            <span className="label">Category</span>
            <select name="category" defaultValue={categoryId ?? ''} className="input w-auto">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (inactive)'}</option>)}
            </select>
          </label>
        </FilterBar>

        {expenses.length === 0 ? <Empty>{daily ? 'No expenses recorded on this day.' : 'No expenses in this period.'}</Empty> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Category</th><th>Paid via</th><th>Notes</th><th>Receipt</th><th>By</th><th className="text-right">Amount</th>{isAdmin && <th></th>}</tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className={e.voided ? 'text-slate-400' : ''}>
                    <td className={`whitespace-nowrap ${e.voided ? 'line-through' : ''}`}>{fmtDate(e.date)}</td>
                    <td className={e.voided ? 'line-through' : ''}>{e.category.name}{e.otherDetail && <div className="text-[12px] text-slate-600">{e.otherDetail}</div>}</td>
                    <td className={e.voided ? 'line-through' : ''}>{PAYMENT_METHOD[e.paidVia]}</td>
                    <td className="max-w-[16rem]">
                      <span className={e.voided ? 'line-through' : ''}>{e.notes ?? '—'}</span>
                      {e.voided && <div className="text-xs text-red-600 no-underline">Voided: {e.voidReason}</div>}
                    </td>
                    <td>
                      {e.attachment ? (
                        <a href={`/api/attachments/${e.attachment.id}`} target="_blank" rel="noreferrer" className="link">
                          {e.attachment.mimeType.startsWith('image/')
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={`/api/attachments/${e.attachment.id}`} alt="Receipt" className="h-10 w-10 rounded border object-cover" />
                            : 'View file'}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="whitespace-nowrap">{e.createdBy.name}</td>
                    <td className={`whitespace-nowrap text-right font-medium ${e.voided ? 'line-through' : ''}`}>{peso(e.amount)}</td>
                    {isAdmin && (
                      <td>
                        {!e.voided && (
                          <details className="text-right">
                            <summary className="cursor-pointer text-xs text-red-600">Void</summary>
                            <ActionForm action={voidExpense.bind(null, e.id)} confirm="Void this expense?" className="mt-2 flex min-w-[14rem] gap-1">
                              <input name="reason" placeholder="Reason" required className="input" />
                              <SubmitButton className="btn-danger btn-sm">Void</SubmitButton>
                            </ActionForm>
                          </details>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-semibold">
                  <td colSpan={6} className="px-3 py-2 text-right">Total (excluding voided)</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{peso(total)}</td>
                  {isAdmin && <td></td>}
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      {subtotals.length > 0 && (
        <Card title="Subtotal per category">
          <TableWrap>
            <table className="table">
              <thead><tr><th>Category</th><th className="text-right">Entries</th><th className="text-right">Amount</th><th className="text-right">Share</th></tr></thead>
              <tbody>
                {subtotals.map(([name, g]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="text-right">{g.count}</td>
                    <td className="text-right font-medium">{peso(g.amount)}</td>
                    <td className="text-right text-slate-500">{total ? ((g.amount / total) * 100).toFixed(1) : '0.0'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}
