import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, parseDateInput, todayManila } from '@/lib/dates';
import { PAY_FREQUENCY, PAY_TYPE, PAYROLL_STATUS } from '@/lib/labels';
import { employeeName } from '@/lib/hr';
import { fmtClock } from '@/lib/timekeeping';
import { Card, DL, Empty, PageHeader, StatusBadge, TableWrap } from '@/components/ui';
import { buildDtr } from '../timekeeping/_lib';
import { DtrStatusBadge, DtrTable, DtrTotalsStats } from '../timekeeping/_components';
import { dtrStatus, fmtHHMM, isDateStr, payPeriodFor, recentPayPeriods, workDaysLabel } from '../timekeeping/_dtr';

export const metadata = { title: 'My time & pay' };

type SP = Promise<{ period?: string }>;

export default async function MePage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const { period } = await searchParams;
  // Self-service: only the employee record linked to this login. Incidents are never queried here.
  const emp = await prisma.employee.findUnique({ where: { userId: user.id } });

  if (!emp) {
    return (
      <div>
        <PageHeader title="My time & pay" />
        <Empty>Your login isn&apos;t linked to an employee record. Ask the owner.</Empty>
      </div>
    );
  }

  const today = todayManila();
  const periods = recentPayPeriods(emp.payFrequency, today, 12);
  const current = isDateStr(period) ? payPeriodFor(emp.payFrequency, period) : periods[0];
  const safe = current.from <= today ? current : periods[0];
  const [{ rows, totals }, todayEntry, holiday, payslips] = await Promise.all([
    buildDtr(emp, safe.from, safe.to),
    prisma.timeEntry.findUnique({ where: { employeeId_workDate: { employeeId: emp.id, workDate: parseDateInput(today)! } } }),
    prisma.holiday.findUnique({ where: { date: parseDateInput(today)! } }),
    prisma.payslip.findMany({
      where: { employeeId: emp.id, run: { status: { in: ['FINALIZED', 'PAID'] } } },
      include: { run: { select: { runNo: true, periodStart: true, periodEnd: true, payDate: true, status: true } } },
      orderBy: { run: { periodStart: 'desc' } },
      take: 24,
    }),
  ]);
  const todayStatus = dtrStatus(emp, today, today, todayEntry, holiday?.type);

  return (
    <div className="space-y-5">
      <PageHeader title="My time & pay" subtitle={`${employeeName(emp)} · ${emp.employeeNo}`} actions={<Link href="/clock" className="btn-secondary">Time clock</Link>} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="My details">
          <DL items={[
            ['Position', emp.position],
            ['Schedule', `${fmtHHMM(emp.shiftStart)} – ${fmtHHMM(emp.shiftEnd)} (${emp.breakMinutes} min break)`],
            ['Work days', workDaysLabel(emp.workDays)],
            ['Pay type', PAY_TYPE[emp.payType]],
            ['Rate', `${peso(emp.rate)} ${emp.payType === 'DAILY' ? 'per day' : 'per month'}`],
            ['Pay schedule', PAY_FREQUENCY[emp.payFrequency]],
          ]} />
        </Card>
        <Card title="Today">
          <div className="flex items-center gap-3">
            <DtrStatusBadge status={todayStatus} />
            {holiday && <span className="text-[13px] text-slate-500">{holiday.name}</span>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <div className="label">Time in</div>
              <div className="num text-[22px] font-semibold">{fmtClock(todayEntry?.timeIn)}</div>
            </div>
            <div>
              <div className="label">Time out</div>
              <div className="num text-[22px] font-semibold">{fmtClock(todayEntry?.timeOut)}</div>
            </div>
          </div>
          {todayEntry && todayEntry.lateMinutes > 0 && <p className="mt-3 text-[13px] text-amber-700">Late {todayEntry.lateMinutes} min today.</p>}
        </Card>
      </div>

      <Card
        title={`My time record · ${fmtDate(parseDateInput(safe.from))} – ${fmtDate(parseDateInput(safe.to))}`}
        actions={
          <form method="get" className="flex items-center gap-2">
            <select name="period" defaultValue={safe.from} className="input h-8 w-auto py-0 text-[12.5px]">
              {periods.map((p, i) => (
                <option key={p.from} value={p.from}>{i === 0 ? 'Current: ' : ''}{p.from} – {p.to}</option>
              ))}
            </select>
            <button type="submit" className="btn-dark btn-sm">View</button>
          </form>
        }
      >
        <div className="space-y-4">
          <DtrTotalsStats totals={totals} />
          <DtrTable rows={rows} />
          <p className="text-[12px] text-slate-500">If a time record is wrong or missing, tell the owner so it can be corrected before payroll.</p>
        </div>
      </Card>

      <Card title="My payslips">
        {payslips.length === 0 ? <Empty>No payslips yet.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Pay period</th><th>Pay date</th><th>Status</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net pay</th><th /></tr></thead>
              <tbody>
                {payslips.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">{fmtDate(p.run.periodStart)} – {fmtDate(p.run.periodEnd)}</td>
                    <td className="whitespace-nowrap">{fmtDate(p.run.payDate)}</td>
                    <td><StatusBadge value={p.run.status} labels={PAYROLL_STATUS} /></td>
                    <td className="text-right whitespace-nowrap">{peso(p.gross)}</td>
                    <td className="text-right whitespace-nowrap">{peso(p.deductions)}</td>
                    <td className="text-right whitespace-nowrap font-semibold">{peso(p.net)}</td>
                    <td className="text-right"><Link href={`/me/payslips/${p.id}`} className="link">View</Link></td>
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
