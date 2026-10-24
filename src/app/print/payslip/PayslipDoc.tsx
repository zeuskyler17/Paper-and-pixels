// Printable payslip (half-letter landscape, 8.5 × 5.5 in). Shared by /print/payslip/[id] and /print/payroll/[id]/payslips.
import type { Prisma } from '@prisma/client';
import { peso } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { fmtMinutes } from '@/lib/timekeeping';
import { PAY_TYPE } from '@/lib/labels';
import type { Settings } from '@/lib/settings';
import { fmtHours, fmtNum, groupLines, rateLabel, sum } from '@/app/(app)/payroll/_lib';

export const PAYSLIP_INCLUDE = {
  run: true,
  employee: { select: { employeeNo: true, firstName: true, lastName: true, middleName: true, position: true } },
  lines: { orderBy: { id: 'asc' } },
} satisfies Prisma.PayslipInclude;

export type PayslipForPrint = Prisma.PayslipGetPayload<{ include: typeof PAYSLIP_INCLUDE }>;

export const PAYSLIP_PAGE_CSS = `
  @page { size: 8.5in 5.5in; margin: 8mm; }
  .slip { width: 8.5in; min-height: 5.5in; position: relative; overflow: hidden; }
  .slip + .slip { margin-top: 6mm; }
  .watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
  .watermark span { transform: rotate(-30deg); font-size: 44px; font-weight: 800; letter-spacing: 0.08em; color: rgba(0,0,0,0.12); white-space: nowrap; border: 4px solid rgba(0,0,0,0.12); padding: 4px 14px; }
  @media print {
    .slip { width: auto; min-height: 0; box-shadow: none !important; padding: 0 !important; break-after: page; }
    .slip:last-child { break-after: auto; }
    .slip + .slip { margin-top: 0; }
    .watermark span { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export function PayslipDoc({ p, s }: { p: PayslipForPrint; s: Settings }) {
  const g = groupLines(p.lines);
  const earnings = sum(g.earnings, (l) => l.amount);
  const attendance = sum(g.attendance, (l) => l.amount);
  const name = `${p.employee.lastName}, ${p.employee.firstName}${p.employee.middleName ? ` ${p.employee.middleName.charAt(0)}.` : ''}`;
  const mark = p.run.status === 'DRAFT' ? 'DRAFT — not final' : p.run.status === 'VOID' ? 'VOID' : null;

  return (
    <div className="slip mx-auto max-w-full bg-white p-[8mm] text-[11px] leading-snug text-black shadow">
      {mark && <div className="watermark" aria-hidden><span>{mark}</span></div>}

      <header className="flex items-start justify-between gap-3 border-b-2 border-black pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0" />
        <div className="flex-1">
          <div className="text-base font-bold leading-tight">{s.shop_name}</div>
          <div>{s.shop_address}</div>
          <div>{[s.shop_contact, s.shop_email].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="text-right">
          <div className="text-[13px] font-bold uppercase tracking-wide">Payslip</div>
          <div className="font-mono font-semibold">{p.run.runNo}</div>
          {mark && <div className="mt-1 border border-black px-1 text-[10px] font-bold">{mark}</div>}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-b border-black py-2">
        <div><span className="font-semibold">Employee:</span> {name}</div>
        <div><span className="font-semibold">Employee no.:</span> <span className="font-mono">{p.employee.employeeNo}</span></div>
        <div><span className="font-semibold">Position:</span> {p.employee.position}</div>
        <div><span className="font-semibold">Pay type:</span> {PAY_TYPE[p.payType]} · {rateLabel(p.payType, p.rate)}</div>
        <div><span className="font-semibold">Period:</span> {fmtDate(p.run.periodStart)} – {fmtDate(p.run.periodEnd)}</div>
        <div><span className="font-semibold">Pay date:</span> {fmtDate(p.run.payDate)}</div>
      </section>

      <section className="grid grid-cols-6 gap-1 border-b border-black py-2 text-center">
        <Att k="Days worked" v={fmtNum(p.daysWorked)} />
        <Att k="Reg. hours" v={fmtHours(p.regularHours)} />
        <Att k="OT hours" v={fmtHours(p.overtimeHours)} />
        <Att k="Late" v={fmtMinutes(p.lateMinutes)} />
        <Att k="Undertime" v={fmtMinutes(p.undertimeMinutes)} />
        <Att k="Absences" v={fmtNum(p.absentDays)} />
      </section>

      <Lines title="Earnings" lines={g.earnings} total={earnings} />
      {g.attendance.length > 0 && <Lines title="Attendance deductions" lines={g.attendance} total={attendance} negative />}
      <div className="mt-1 flex justify-between border-b border-black py-1 font-bold">
        <span>GROSS PAY</span><span className="font-mono">{peso(p.gross)}</span>
      </div>
      <Lines title="Deductions" lines={g.deductions} total={p.deductions} negative />

      <div className="mt-3 flex items-center justify-between border-2 border-black px-3 py-2">
        <span className="text-[13px] font-bold tracking-wide">NET PAY</span>
        <span className="font-mono text-[18px] font-bold">{peso(p.net)}</span>
      </div>

      {p.notes && <p className="mt-2 whitespace-pre-line"><span className="font-semibold">Notes:</span> {p.notes}</p>}

      <p className="mt-3 text-[10px]">I acknowledge receipt of the net pay stated above as full payment for the period.</p>
      <div className="mt-8 grid grid-cols-[2fr_1fr] gap-6">
        <div className="border-t border-black pt-1 text-center">Received by (signature over printed name)</div>
        <div className="border-t border-black pt-1 text-center">Date</div>
      </div>
    </div>
  );
}

function Att({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide">{k}</div>
      <div className="font-mono font-semibold">{v}</div>
    </div>
  );
}

function Lines({ title, lines, total, negative }: { title: string; lines: { id: number; label: string; amount: number }[]; total: number; negative?: boolean }) {
  return (
    <table className="mt-2 w-full border-collapse">
      <thead>
        <tr className="border-b border-black text-left">
          <th className="py-0.5">{title}</th>
          <th className="w-24 py-0.5 text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 ? (
          <tr><td className="py-0.5 italic" colSpan={2}>None</td></tr>
        ) : lines.map((l) => (
          <tr key={l.id} className="border-b border-dotted border-gray-400">
            <td className="py-0.5 pr-2">{l.label}</td>
            <td className="py-0.5 text-right font-mono">{negative ? '−' : ''}{peso(l.amount)}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className="py-0.5">Total {title.toLowerCase()}</td>
          <td className="py-0.5 text-right font-mono">{negative ? '−' : ''}{peso(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
