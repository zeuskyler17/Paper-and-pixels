import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { addDays, fmtDate, fmtDateTime, parseDateInput, todayManila } from '@/lib/dates';
import { employeeName } from '@/lib/hr';
import { DAY_TYPE, fmtClock, fmtMinutes } from '@/lib/timekeeping';
import { DTR_STATUS, fmtHHMM, isDateStr, monthRange, workDaysLabel } from '@/app/(app)/timekeeping/_dtr';
import { buildDtr } from '@/app/(app)/timekeeping/_lib';

export const metadata = { title: 'Daily time record' };

type SP = Promise<{ employee?: string; from?: string; to?: string }>;

const SHORT_DAY: Record<string, string> = {
  REGULAR: 'Regular', REST_DAY: 'Rest day', SPECIAL_HOLIDAY: 'Special hol.', REGULAR_HOLIDAY: 'Regular hol.', PAID_LEAVE: 'Paid leave',
};

export default async function PrintDtrPage({ searchParams }: { searchParams: SP }) {
  await requireUser('hr');
  const sp = await searchParams;
  const emp = await prisma.employee.findUnique({ where: { id: Number(sp.employee) || 0 } });
  if (!emp) notFound();
  const month = monthRange(todayManila());
  let from = isDateStr(sp.from) ? sp.from : month.from;
  let to = isDateStr(sp.to) ? sp.to : month.to;
  if (to < from) [from, to] = [to, from];
  if (parseDateInput(to)!.getTime() - parseDateInput(from)!.getTime() > 92 * 86_400_000) to = addDays(from, 92);

  const [{ rows, totals }, s] = await Promise.all([buildDtr(emp, from, to), getSettings()]);

  return (
    <>
      <style>{`
        @page { size: 8.5in 5.5in; margin: 8mm; }
        .dtr { width: 8.5in; min-height: 5.5in; }
        .dtr td, .dtr th { padding: 2px 4px; }
        @media print { .dtr { width: auto; min-height: 0; box-shadow: none !important; padding: 0 !important; } }
      `}</style>
      <div className="dtr mx-auto max-w-full bg-white p-[8mm] text-[10px] leading-snug text-black shadow">
        <header className="flex items-start justify-between gap-3 border-b-2 border-black pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={56} height={56} className="h-14 w-14 shrink-0" />
          <div className="flex-1">
            <div className="text-lg font-bold leading-tight">{s.shop_name}</div>
            <div>{s.shop_address}</div>
            <div>{[s.shop_contact, s.shop_email].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-bold tracking-wide">DAILY TIME RECORD</div>
            <div>{fmtDate(parseDateInput(from))} – {fmtDate(parseDateInput(to))}</div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-b border-black py-2">
          <div><span className="font-semibold">Employee:</span> {employeeName(emp)}</div>
          <div><span className="font-semibold">Employee no.:</span> {emp.employeeNo}</div>
          <div><span className="font-semibold">Position:</span> {emp.position}</div>
          <div>
            <span className="font-semibold">Schedule:</span> {fmtHHMM(emp.shiftStart)} – {fmtHHMM(emp.shiftEnd)}, {workDaysLabel(emp.workDays)} ({emp.breakMinutes} min break)
          </div>
        </section>

        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th>Date</th><th>Day</th><th>Day type</th>
              <th className="text-right">Time in</th><th>Breaks</th><th className="text-right">Time out</th>
              <th className="text-right">Late</th><th className="text-right">Undertime</th>
              <th className="text-right">Reg. hrs</th><th className="text-right">OT</th><th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = r.entry;
              const weekend = r.status === 'REST_DAY';
              const nextDay = e?.timeOut && new Date(e.timeOut).getTime() - parseDateInput(r.date)!.getTime() >= 86_400_000;
              const remark = r.holiday?.name ?? (['ABSENT', 'INCOMPLETE'].includes(r.status) ? DTR_STATUS[r.status].label : '');
              return (
                <tr key={r.date} className={`border-b border-dotted border-gray-400 ${weekend ? 'bg-gray-100' : ''}`}>
                  <td className="whitespace-nowrap">{r.date.slice(5)}</td>
                  <td>{r.weekday}</td>
                  <td className="whitespace-nowrap">{SHORT_DAY[r.dayType]}</td>
                  <td className="text-right whitespace-nowrap">{e?.timeIn ? fmtClock(e.timeIn) : ''}</td>
                  <td className="text-[8.5px] leading-tight">{e?.breaks.map((b) => `${fmtClock(b.startAt)}–${b.endAt ? fmtClock(b.endAt) : '…'}`).join(', ')}{e?.overbreakMinutes ? <b> ({fmtMinutes(e.overbreakMinutes)} over)</b> : null}</td>
                  <td className="text-right whitespace-nowrap">{e?.timeOut ? `${fmtClock(e.timeOut)}${nextDay ? ' +1' : ''}` : ''}</td>
                  <td className="text-right">{e?.lateMinutes ? fmtMinutes(e.lateMinutes) : ''}</td>
                  <td className="text-right">{e?.undertimeMinutes ? fmtMinutes(e.undertimeMinutes) : ''}</td>
                  <td className="text-right">{e?.regularMinutes ? (e.regularMinutes / 60).toFixed(2) : ''}</td>
                  <td className="text-right whitespace-nowrap">{e?.overtimeMinutes ? `${fmtMinutes(e.overtimeMinutes)}${e.otApproved ? '' : '*'}` : ''}</td>
                  <td className="text-[9.5px]">{remark}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-semibold">
              <td colSpan={6}>TOTAL — {totals.present} day(s) present{totals.paidLeave ? `, ${totals.paidLeave} paid leave` : ''}, {totals.absent} absent</td>
              <td className="text-right">{fmtMinutes(totals.lateMinutes)}</td>
              <td className="text-right">{fmtMinutes(totals.undertimeMinutes)}</td>
              <td className="text-right">{(totals.regularMinutes / 60).toFixed(2)}</td>
              <td className="text-right whitespace-nowrap">{fmtMinutes(totals.otApproved)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div className="mt-1 text-[9.5px]">
          OT total counts approved overtime only{totals.otUnapproved ? `; * = not approved (${fmtMinutes(totals.otUnapproved)})` : ''}. +1 = time out on the next day.
          Day types: {Object.values(DAY_TYPE).join(', ')}.
        </div>

        <p className="mt-6">
          I certify on my honor that the above is a true and correct report of the hours of work performed, record of which was made
          daily at the time of arrival and departure from the office.
        </p>

        <div className="mt-12 grid grid-cols-2 gap-12 text-center">
          <div>
            <div className="border-t border-black pt-1 font-semibold">{employeeName(emp)}</div>
            <div>Employee</div>
          </div>
          <div>
            <div className="border-t border-black pt-1 font-semibold">&nbsp;</div>
            <div>Verified by</div>
          </div>
        </div>
        <div className="mt-8 text-right text-[9px] text-gray-600">Printed {fmtDateTime(new Date())}</div>
      </div>
    </>
  );
}
