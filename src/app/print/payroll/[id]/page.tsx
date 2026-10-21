import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { peso } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { PAYROLL_STATUS, PAY_FREQUENCY } from '@/lib/labels';
import { fmtHours, fmtNum, groupLines, rateLabel, sum } from '@/app/(app)/payroll/_lib';

export const metadata = { title: 'Payroll register' };

export default async function PrintPayrollRegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('hr');
  const { id } = await params;
  const [run, s] = await Promise.all([
    prisma.payrollRun.findUnique({
      where: { id: Number(id) || 0 },
      include: {
        payslips: {
          include: {
            employee: { select: { employeeNo: true, firstName: true, lastName: true, position: true } },
            lines: { select: { kind: true, code: true, amount: true } },
          },
          orderBy: [{ employee: { lastName: 'asc' } }, { employee: { firstName: 'asc' } }],
        },
      },
    }),
    getSettings(),
  ]);
  if (!run) notFound();

  const rows = run.payslips.map((p) => {
    const g = groupLines(p.lines);
    return { p, earnings: sum(g.earnings, (l) => l.amount), attendance: sum(g.attendance, (l) => l.amount) };
  });
  const tot = {
    days: sum(run.payslips, (p) => p.daysWorked),
    reg: sum(run.payslips, (p) => p.regularHours),
    ot: sum(run.payslips, (p) => p.overtimeHours),
    tardy: sum(run.payslips, (p) => p.lateMinutes + p.undertimeMinutes),
    abs: sum(run.payslips, (p) => p.absentDays),
    earnings: sum(rows, (r) => r.earnings),
    attendance: sum(rows, (r) => r.attendance),
  };
  const mark = run.status === 'DRAFT' ? 'DRAFT — not final' : run.status === 'VOID' ? `VOID — ${run.voidReason ?? ''}` : null;

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        .register { width: 297mm; min-height: 210mm; }
        .register td, .register th { padding: 3px 4px; }
        @media print { .register { width: auto; min-height: 0; box-shadow: none !important; padding: 0 !important; } }
      `}</style>
      <div className="register mx-auto max-w-full overflow-x-auto bg-white p-[10mm] text-[10.5px] leading-snug text-black shadow">
        <header className="flex items-start justify-between gap-3 border-b-2 border-black pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0" />
          <div className="flex-1">
            <div className="text-base font-bold leading-tight">{s.shop_name}</div>
            <div>{s.shop_address}</div>
            <div>{[s.shop_contact, s.shop_email].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-bold uppercase tracking-wide">Payroll Register</div>
            <div className="font-mono font-semibold">{run.runNo}</div>
            <div>Status: {PAYROLL_STATUS[run.status]}</div>
            {mark && <div className="mt-1 border border-black px-1 font-bold">{mark}</div>}
          </div>
        </header>

        <section className="flex flex-wrap gap-x-8 gap-y-0.5 border-b border-black py-2">
          <div><span className="font-semibold">Period:</span> {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}</div>
          <div><span className="font-semibold">Pay date:</span> {fmtDate(run.payDate)}</div>
          <div><span className="font-semibold">Frequency:</span> {PAY_FREQUENCY[run.frequency]}</div>
          <div><span className="font-semibold">Employees:</span> {run.payslips.length}</div>
          <div><span className="font-semibold">Printed:</span> {fmtDateTime(new Date())}</div>
        </section>

        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left align-bottom">
              <th>#</th><th>Employee</th><th>Pay type / rate</th>
              <th className="text-right">Days</th><th className="text-right">Reg. hrs</th><th className="text-right">OT hrs</th>
              <th className="text-right">Late/UT min</th><th className="text-right">Abs.</th>
              <th className="text-right">Earnings</th><th className="text-right">Att. ded.</th>
              <th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net pay</th>
              <th className="w-28 text-center">Signature</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, earnings, attendance }, i) => (
              <tr key={p.id} className="border-b border-dotted border-gray-400 align-top">
                <td>{i + 1}</td>
                <td>
                  <div className="font-semibold">{p.employee.lastName}, {p.employee.firstName}</div>
                  <div className="font-mono text-[9.5px]">{p.employee.employeeNo} · {p.employee.position}</div>
                </td>
                <td className="whitespace-nowrap">{p.payType === 'MONTHLY' ? 'Monthly' : 'Daily'} · {rateLabel(p.payType, p.rate)}</td>
                <td className="text-right font-mono">{fmtNum(p.daysWorked)}</td>
                <td className="text-right font-mono">{fmtHours(p.regularHours)}</td>
                <td className="text-right font-mono">{fmtHours(p.overtimeHours)}</td>
                <td className="text-right font-mono">{fmtNum(p.lateMinutes + p.undertimeMinutes)}</td>
                <td className="text-right font-mono">{fmtNum(p.absentDays)}</td>
                <td className="whitespace-nowrap text-right font-mono">{peso(earnings)}</td>
                <td className="whitespace-nowrap text-right font-mono">{attendance ? `−${peso(attendance)}` : '—'}</td>
                <td className="whitespace-nowrap text-right font-mono">{peso(p.gross)}</td>
                <td className="whitespace-nowrap text-right font-mono">{peso(p.deductions)}</td>
                <td className="whitespace-nowrap text-right font-mono font-bold">{peso(p.net)}</td>
                <td className="border-b border-black" />
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={14} className="py-3 text-center italic">No payslips in this payroll run.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-bold">
              <td colSpan={3}>TOTALS</td>
              <td className="text-right font-mono">{fmtNum(tot.days)}</td>
              <td className="text-right font-mono">{fmtHours(tot.reg)}</td>
              <td className="text-right font-mono">{fmtHours(tot.ot)}</td>
              <td className="text-right font-mono">{fmtNum(tot.tardy)}</td>
              <td className="text-right font-mono">{fmtNum(tot.abs)}</td>
              <td className="whitespace-nowrap text-right font-mono">{peso(tot.earnings)}</td>
              <td className="whitespace-nowrap text-right font-mono">{tot.attendance ? `−${peso(tot.attendance)}` : '—'}</td>
              <td className="whitespace-nowrap text-right font-mono">{peso(run.totalGross)}</td>
              <td className="whitespace-nowrap text-right font-mono">{peso(run.totalDeductions)}</td>
              <td className="whitespace-nowrap text-right font-mono">{peso(run.totalNet)}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        {run.notes && <p className="mt-2"><span className="font-semibold">Notes:</span> {run.notes}</p>}

        <div className="mt-12 grid grid-cols-3 gap-10">
          <div className="border-t border-black pt-1 text-center">Prepared by: {user.name}</div>
          <div className="border-t border-black pt-1 text-center">Approved by</div>
          <div className="border-t border-black pt-1 text-center">Received (cash released by)</div>
        </div>
      </div>
    </>
  );
}
