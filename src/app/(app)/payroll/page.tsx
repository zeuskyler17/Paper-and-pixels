import Link from 'next/link';
import type { PayrollStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, manilaYear, parseDateInput, startOfMonthManila } from '@/lib/dates';
import { PAYROLL_STATUS, options } from '@/lib/labels';
import { Card, Empty, FilterBar, PageHeader, Stat, StatusBadge, TableWrap } from '@/components/ui';
import { FREQ_SHORT } from './_lib';

export const metadata = { title: 'Payroll' };

type SP = Promise<{ status?: string; year?: string }>;

export default async function PayrollPage({ searchParams }: { searchParams: SP }) {
  await requireUser('hr');
  const { status = '', year = '' } = await searchParams;

  const where: Prisma.PayrollRunWhereInput = {};
  if (status in PAYROLL_STATUS) where.status = status as PayrollStatus;
  const y = Number(year);
  if (y >= 2000 && y <= 2100) where.payDate = { gte: parseDateInput(`${y}-01-01`)!, lt: parseDateInput(`${y + 1}-01-01`)! };

  const monthStart = parseDateInput(startOfMonthManila())!;
  const [y0, m0] = startOfMonthManila().split('-').map(Number);
  const nextMonth = parseDateInput(m0 === 12 ? `${y0 + 1}-01-01` : `${y0}-${String(m0 + 1).padStart(2, '0')}-01`)!;

  const [runs, lastPaid, monthPaid, advances, noPin, years] = await Promise.all([
    prisma.payrollRun.findMany({ where, orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], take: 200, include: { _count: { select: { payslips: true } } } }),
    prisma.payrollRun.findFirst({ where: { status: 'PAID' }, orderBy: [{ payDate: 'desc' }, { id: 'desc' }] }),
    prisma.payrollRun.aggregate({ where: { status: 'PAID', payDate: { gte: monthStart, lt: nextMonth } }, _sum: { totalNet: true }, _count: true }),
    prisma.cashAdvance.aggregate({ where: { status: 'OPEN' }, _sum: { balance: true }, _count: true }),
    prisma.employee.count({ where: { pinHash: null, status: { in: ['ACTIVE', 'ON_LEAVE'] } } }),
    prisma.payrollRun.findMany({ select: { payDate: true }, orderBy: { payDate: 'asc' } }),
  ]);
  const yearOptions = Array.from(new Set([...years.map((r) => manilaYear(r.payDate)), manilaYear()])).sort((a, b) => b - a);
  const shown = runs.filter((r) => r.status !== 'VOID');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payroll"
        subtitle={`${runs.length}${runs.length === 200 ? '+' : ''} payroll run(s) · ${peso(shown.reduce((s, r) => s + r.totalNet, 0))} net (excluding void)`}
        actions={
          <>
            <Link href="/payroll/13th-month" className="btn-secondary">13th month pay</Link>
            <Link href="/payroll/new" className="btn-primary">+ New payroll run</Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Last paid run"
          value={lastPaid ? peso(lastPaid.totalNet) : '—'}
          hint={lastPaid ? `${lastPaid.runNo} · paid ${fmtDate(lastPaid.payDate)}` : 'No paid payroll yet'}
          href={lastPaid ? `/payroll/${lastPaid.id}` : undefined}
        />
        <Stat label="Payroll this month" value={peso(monthPaid._sum.totalNet ?? 0)} hint={`${monthPaid._count} paid run(s) by pay date`} />
        <Stat
          label="Open cash advances"
          value={peso(advances._sum.balance ?? 0)}
          hint={`${advances._count} open advance(s) — deducted automatically`}
          tone={(advances._sum.balance ?? 0) > 0 ? 'amber' : undefined}
        />
        <Stat
          label="No time-clock PIN"
          value={noPin}
          hint={noPin ? 'Active employees who cannot clock in' : 'Every active employee has a PIN'}
          href="/employees"
          tone={noPin ? 'red' : 'green'}
        />
      </div>

      <Card>
        <FilterBar>
          <select name="status" defaultValue={status} className="input w-auto">
            <option value="">All statuses</option>
            {options(PAYROLL_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select name="year" defaultValue={year} className="input w-auto">
            <option value="">All years</option>
            {yearOptions.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
          </select>
        </FilterBar>
        {runs.length === 0 ? (
          <Empty>No payroll runs found. <Link href="/payroll/new" className="link">Create the first one</Link>.</Empty>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Run no.</th><th>Frequency</th><th>Period</th><th>Pay date</th>
                  <th className="text-right">Payslips</th><th className="text-right">Gross</th><th className="text-right">Deductions</th>
                  <th className="text-right">Net</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const muted = r.status === 'VOID' ? 'text-slate-400 line-through' : '';
                  return (
                    <tr key={r.id}>
                      <td><Link href={`/payroll/${r.id}`} className="link num whitespace-nowrap">{r.runNo}</Link></td>
                      <td>{FREQ_SHORT[r.frequency]}</td>
                      <td className="whitespace-nowrap">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</td>
                      <td className="whitespace-nowrap">{fmtDate(r.payDate)}</td>
                      <td className="text-right">{r._count.payslips}</td>
                      <td className={`text-right whitespace-nowrap ${muted}`}>{peso(r.totalGross)}</td>
                      <td className={`text-right whitespace-nowrap ${muted}`}>{peso(r.totalDeductions)}</td>
                      <td className={`text-right whitespace-nowrap font-semibold ${muted}`}>{peso(r.totalNet)}</td>
                      <td><StatusBadge value={r.status} labels={PAYROLL_STATUS} /></td>
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
