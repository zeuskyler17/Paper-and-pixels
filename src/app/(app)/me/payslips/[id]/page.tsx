import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PayslipLine } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { peso } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { PAY_TYPE, PAYROLL_STATUS } from '@/lib/labels';
import { employeeName } from '@/lib/hr';
import { fmtMinutes } from '@/lib/timekeeping';
import { PrintButton } from '@/components/PrintButton';

export const metadata = { title: 'My payslip' };

const ATTENDANCE = new Set(['ABSENCES', 'LATE_UNDERTIME']);

export default async function MyPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [slip, s] = await Promise.all([
    prisma.payslip.findUnique({
      where: { id: Number(id) || 0 },
      include: {
        employee: { select: { userId: true, firstName: true, lastName: true, nickname: true, employeeNo: true, position: true } },
        run: { select: { runNo: true, status: true, periodStart: true, periodEnd: true, payDate: true } },
        lines: { orderBy: { id: 'asc' } },
      },
    }),
    getSettings(),
  ]);
  // Only the employee's own payslip, and only once the payroll is finalized or paid.
  if (!slip || slip.employee.userId !== user.id || (slip.run.status !== 'FINALIZED' && slip.run.status !== 'PAID')) notFound();

  const earnings = slip.lines.filter((l) => l.kind === 'EARNING');
  const attendance = slip.lines.filter((l) => l.kind === 'DEDUCTION' && ATTENDANCE.has(l.code));
  const deductions = slip.lines.filter((l) => l.kind === 'DEDUCTION' && !ATTENDANCE.has(l.code));
  const sum = (ls: PayslipLine[]) => ls.reduce((a, l) => a + l.amount, 0);

  return (
    <div>
      <style>{`
        @page { size: A5; margin: 10mm; }
        @media print { main { margin: 0 !important; padding: 0 !important; max-width: none !important; } .slip { box-shadow: none !important; border: 0 !important; padding: 0 !important; } }
      `}</style>
      <div className="no-print mb-4 flex flex-wrap justify-between gap-2">
        <Link href="/me" className="btn-secondary">← My time & pay</Link>
        <PrintButton label="Print payslip" />
      </div>

      <div className="slip card mx-auto max-w-2xl p-6 text-[13px] text-black">
        <header className="flex items-start gap-3 border-b-2 border-black pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0" />
          <div className="flex-1">
            <div className="text-[16px] font-bold leading-tight">{s.shop_name}</div>
            <div className="text-[12px]">{s.shop_address}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wide">Payslip</div>
            <div className="num font-bold">{slip.run.runNo}</div>
            <div className="text-[11px] uppercase">{PAYROLL_STATUS[slip.run.status]}</div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-x-6 gap-y-1 border-b border-black py-3 sm:grid-cols-2">
          <div><span className="font-semibold">Employee:</span> {employeeName(slip.employee)} ({slip.employee.employeeNo})</div>
          <div><span className="font-semibold">Position:</span> {slip.employee.position}</div>
          <div><span className="font-semibold">Pay period:</span> {fmtDate(slip.run.periodStart)} – {fmtDate(slip.run.periodEnd)}</div>
          <div><span className="font-semibold">Pay date:</span> {fmtDate(slip.run.payDate)}</div>
          <div><span className="font-semibold">Pay type:</span> {PAY_TYPE[slip.payType]} · {peso(slip.rate)}{slip.payType === 'DAILY' ? '/day' : '/month'}</div>
          <div><span className="font-semibold">Daily rate:</span> {peso(slip.dailyRate)}</div>
        </section>

        <section className="grid grid-cols-2 gap-2 border-b border-black py-3 text-[12px] sm:grid-cols-5">
          <Fig k="Days worked" v={String(slip.daysWorked)} />
          <Fig k="Regular hrs" v={String(slip.regularHours)} />
          <Fig k="OT hrs" v={String(slip.overtimeHours)} />
          <Fig k="Late / UT" v={fmtMinutes(slip.lateMinutes + slip.undertimeMinutes)} />
          <Fig k="Absent days" v={String(slip.absentDays)} />
        </section>

        <Group title="Earnings" lines={earnings} total={sum(earnings)} />
        {attendance.length > 0 && <Group title="Attendance deductions" lines={attendance} total={sum(attendance)} minus />}
        <div className="flex justify-between border-b border-black py-2 font-bold">
          <span>GROSS PAY</span><span className="num">{peso(slip.gross)}</span>
        </div>
        <Group title="Deductions" lines={deductions} total={slip.deductions} minus />

        <div className="mt-2 flex justify-between border-y-2 border-black py-2 text-[16px] font-bold">
          <span>NET PAY</span><span className="num">{peso(slip.net)}</span>
        </div>
        {slip.notes && <p className="mt-3 text-[12px]"><span className="font-semibold">Notes:</span> {slip.notes}</p>}

        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-[12px]">
          <div><div className="border-t border-black pt-1">Received by (employee)</div></div>
          <div><div className="border-t border-black pt-1">Prepared by</div></div>
        </div>
      </div>
    </div>
  );
}

function Fig({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{k}</div>
      <div className="num font-semibold">{v}</div>
    </div>
  );
}

function Group({ title, lines, total, minus = false }: { title: string; lines: PayslipLine[]; total: number; minus?: boolean }) {
  return (
    <section className="border-b border-black py-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">{title}</div>
      {lines.length === 0 ? <div className="text-slate-500">None</div> : (
        <table className="w-full">
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="py-0.5 pr-2">{l.label}</td>
                <td className="num w-28 py-0.5 text-right">{minus ? '−' : ''}{peso(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-dotted border-gray-400 font-semibold">
              <td className="py-0.5">Total {title.toLowerCase()}</td>
              <td className="num py-0.5 text-right">{minus ? '−' : ''}{peso(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
