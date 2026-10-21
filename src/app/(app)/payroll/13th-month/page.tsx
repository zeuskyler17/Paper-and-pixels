import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { manilaYear, parseDateInput, toDateInput } from '@/lib/dates';
import { EMPLOYMENT_STATUS } from '@/lib/labels';
import { employeeName } from '@/lib/hr';
import { PrintButton } from '@/components/PrintButton';
import { Card, Empty, FilterBar, PageHeader, Stat, StatusBadge, TableWrap } from '@/components/ui';
import { THIRTEENTH_MINUS, THIRTEENTH_PLUS } from '../_lib';

export const metadata = { title: '13th month pay' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default async function ThirteenthMonthPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireUser('hr');
  const sp = await searchParams;
  const current = manilaYear();
  const y = Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : current;

  const payslips = await prisma.payslip.findMany({
    where: {
      run: { status: { in: ['FINALIZED', 'PAID'] }, payDate: { gte: parseDateInput(`${y}-01-01`)!, lt: parseDateInput(`${y + 1}-01-01`)! } },
    },
    select: {
      employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true, nickname: true, position: true, status: true } },
      run: { select: { payDate: true } },
      lines: { where: { code: { in: [...THIRTEENTH_PLUS, ...THIRTEENTH_MINUS] }, manual: false }, select: { code: true, kind: true, amount: true } },
    },
  });

  type Row = { emp: (typeof payslips)[number]['employee']; plus: number; minus: number; months: Set<number>; slips: number };
  const byEmp = new Map<number, Row>();
  for (const p of payslips) {
    const r = byEmp.get(p.employee.id) ?? { emp: p.employee, plus: 0, minus: 0, months: new Set<number>(), slips: 0 };
    r.slips += 1;
    r.months.add(Number(toDateInput(p.run.payDate).slice(5, 7)));
    for (const l of p.lines) {
      if (l.kind === 'EARNING' && THIRTEENTH_PLUS.includes(l.code)) r.plus += l.amount;
      else if (l.kind === 'DEDUCTION' && THIRTEENTH_MINUS.includes(l.code)) r.minus += l.amount;
    }
    byEmp.set(p.employee.id, r);
  }
  const rows = Array.from(byEmp.values())
    .map((r) => {
      const basic = Math.max(0, r.plus - r.minus);
      return { ...r, basic, thirteenth: Math.round(basic / 12) };
    })
    .sort((a, b) => a.emp.lastName.localeCompare(b.emp.lastName) || a.emp.firstName.localeCompare(b.emp.firstName));
  const totalBasic = rows.reduce((s, r) => s + r.basic, 0);
  const total13 = rows.reduce((s, r) => s + r.thirteenth, 0);
  const years = Array.from({ length: 6 }, (_, i) => current - i);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`13th month pay — ${y}`}
        subtitle="Total basic salary earned in the year ÷ 12. Due on or before December 24."
        actions={
          <>
            <Link href="/payroll" className="btn-secondary no-print">← Payroll</Link>
            <PrintButton />
          </>
        }
      />

      <div className="no-print">
        <FilterBar>
          <select name="year" defaultValue={y} className="input w-auto">
            {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
          </select>
        </FilterBar>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Employees" value={rows.length} />
        <Stat label="Total basic salary" value={peso(totalBasic)} />
        <Stat label="Total 13th month pay" value={peso(total13)} hint={`Due on or before Dec 24, ${y}`} />
      </div>

      <Card title="Per employee">
        {rows.length === 0 ? (
          <Empty>No finalized or paid payroll with a pay date in {y}.</Empty>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th><th>Status</th><th>Months covered</th><th className="text-right">Payslips</th>
                  <th className="text-right">Basic + paid leave</th><th className="text-right">Less absences / late</th>
                  <th className="text-right">Basic salary</th><th className="text-right">13th month</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const months = Array.from(r.months).sort((a, b) => a - b);
                  return (
                    <tr key={r.emp.id}>
                      <td className="min-w-[10rem]">
                        <div className="font-medium">{employeeName(r.emp)}</div>
                        <div className="num text-xs text-slate-500">{r.emp.employeeNo} · {r.emp.position}</div>
                      </td>
                      <td><StatusBadge value={r.emp.status} labels={EMPLOYMENT_STATUS} /></td>
                      <td className="text-xs">
                        <div className="font-medium">{months.length} month(s)</div>
                        <div className="text-slate-500">{months.map((m) => MONTHS[m - 1]).join(', ')}</div>
                      </td>
                      <td className="text-right">{r.slips}</td>
                      <td className="text-right whitespace-nowrap">{peso(r.plus)}</td>
                      <td className="text-right whitespace-nowrap">{r.minus ? `−${peso(r.minus)}` : '—'}</td>
                      <td className="text-right whitespace-nowrap">{peso(r.basic)}</td>
                      <td className="text-right whitespace-nowrap font-semibold">{peso(r.thirteenth)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={6}>Totals</td>
                  <td className="text-right whitespace-nowrap">{peso(totalBasic)}</td>
                  <td className="text-right whitespace-nowrap">{peso(total13)}</td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="How it is computed">
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-600">
          <li>Counts payslips of <b>finalized or paid</b> payroll runs whose <b>pay date</b> falls in {y}. Draft and void runs are ignored.</li>
          <li>Basic salary = basic pay + paid leave − absences − late/undertime deductions.</li>
          <li>Excluded (per PD 851 rules): overtime, rest day and holiday premiums, holiday pay, allowances, bonuses and other manual lines.</li>
          <li>13th month pay = basic salary ÷ 12, payable on or before <b>December 24</b>. Employees who resigned are entitled to a prorated amount.</li>
        </ul>
      </Card>
    </div>
  );
}
