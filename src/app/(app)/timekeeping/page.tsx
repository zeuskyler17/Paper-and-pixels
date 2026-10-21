import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Employee } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { addDays, fmtDate, parseDateInput, todayManila } from '@/lib/dates';
import { employeeName } from '@/lib/hr';
import { DAY_TYPE, dayTypeFor, fmtClock, fmtMinutes } from '@/lib/timekeeping';
import { Card, Empty, FilterBar, PageHeader, Stat, TableWrap } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { dtrStatus, employedOn, fmtHHMM, isDateStr, monthRange, weekdayShort, workDaysLabel } from './_dtr';
import { buildDtr } from './_lib';
import { DtrStatusBadge, DtrTable, DtrTotalsStats, Flag, OtCell, Pin, Selfie, TimeOutCell } from './_components';
import { openFlagCount, punchFlags } from '@/lib/clockFlags';
import { getSettings } from '@/lib/settings';
import { parseLatLng } from '@/lib/geo';

/** Shop coordinates from Settings (null when not set) — used for "how far from the shop" on each punch. */
const shopPoint = async () => parseLatLng((await getSettings()).shop_location);
import { approveAllOt } from './actions';

export const metadata = { title: 'Timekeeping' };

type SP = Promise<{ date?: string; employee?: string; from?: string; to?: string }>;

export default async function TimekeepingPage({ searchParams }: { searchParams: SP }) {
  await requireUser('hr');
  const sp = await searchParams;
  const employees = await prisma.employee.findMany({
    orderBy: [{ status: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, nickname: true, status: true },
  });

  const header = (
    <PageHeader
      title="Timekeeping"
      subtitle="Daily time records (DTR), corrections and overtime approval"
      actions={<>
        <Link href="/clock" className="btn-secondary">Time clock</Link>
        <Link href="/timekeeping/holidays" className="btn-secondary">Holidays</Link>
        <Link href="/settings" className="btn-secondary" title="Late grace period (late_grace_minutes)">Settings</Link>
        <Link href="/timekeeping/entry" className="btn-primary">+ Add / edit entry</Link>
      </>}
    />
  );

  const empId = Number(sp.employee) || 0;
  return (
    <div className="space-y-5">
      {header}
      <FilterBar>
        <label className="text-xs text-slate-500">Employee
          <select name="employee" defaultValue={empId || ''} className="input w-56">
            <option value="">All — daily view</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{employeeName(e)}{e.status === 'ACTIVE' ? '' : ` (${e.status.toLowerCase().replace('_', ' ')})`}</option>
            ))}
          </select>
        </label>
        {empId ? <>
          <label className="text-xs text-slate-500">From<input type="date" name="from" defaultValue={sp.from} className="input w-auto" /></label>
          <label className="text-xs text-slate-500">To<input type="date" name="to" defaultValue={sp.to} className="input w-auto" /></label>
        </> : (
          <label className="text-xs text-slate-500">Date<input type="date" name="date" defaultValue={isDateStr(sp.date) ? sp.date : todayManila()} className="input w-auto" /></label>
        )}
      </FilterBar>
      {empId ? <RangeView employeeId={empId} from={sp.from} to={sp.to} /> : <DailyView date={isDateStr(sp.date) ? sp.date : todayManila()} />}
    </div>
  );
}

/* ─────────────── Daily view: every active employee on one date ─────────────── */

async function DailyView({ date }: { date: string }) {
  const shop = await shopPoint();
  const workDate = parseDateInput(date)!;
  const today = todayManila();
  const [entries, holiday] = await Promise.all([
    prisma.timeEntry.findMany({ where: { workDate } }),
    prisma.holiday.findUnique({ where: { date: workDate } }),
  ]);
  const flags = await punchFlags(entries);
  const flagged = openFlagCount(flags);
  const withEntry = new Set(entries.map((e) => e.employeeId));
  const employees = await prisma.employee.findMany({
    where: { OR: [{ status: { in: ['ACTIVE', 'ON_LEAVE'] } }, { id: { in: [...withEntry] } }] },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  const byEmp = new Map(entries.map((e) => [e.employeeId, e]));
  const lockSlips = await prisma.payslip.findMany({
    where: { run: { status: { in: ['FINALIZED', 'PAID'] }, periodStart: { lte: workDate }, periodEnd: { gte: workDate } } },
    select: { employeeId: true },
  });
  const locked = new Set(lockSlips.map((s) => s.employeeId));

  const rows = employees.map((emp) => {
    const entry = byEmp.get(emp.id) ?? null;
    const employed = employedOn(emp, date);
    return { emp, entry, employed, status: dtrStatus(emp, date, today, entry, holiday?.type, employed), dayType: entry?.dayType ?? dayTypeFor(emp, date, holiday?.type) };
  }).filter((r) => r.employed || r.entry);

  const count = (...s: string[]) => rows.filter((r) => s.includes(r.status)).length;
  const prev = addDays(date, -1), next = addDays(date, 1);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/timekeeping?date=${prev}`} className="btn-secondary btn-sm">← {weekdayShort(prev)}</Link>
        <div className="px-1 text-[15px] font-semibold">
          {weekdayShort(date)}, {fmtDate(workDate)}
          {date === today && <span className="ml-2 text-[12px] font-medium text-brand-700">Today</span>}
        </div>
        <Link href={`/timekeeping?date=${next}`} className="btn-secondary btn-sm">{weekdayShort(next)} →</Link>
        {date !== today && <Link href="/timekeeping" className="link text-[12px]">Go to today</Link>}
        {holiday && <span className="ml-auto rounded bg-violet-50 px-2 py-1 text-[12px] font-medium text-violet-800 ring-1 ring-inset ring-violet-200">{holiday.name} · {holiday.type === 'REGULAR' ? 'Regular holiday' : 'Special non-working day'}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Present" value={count('PRESENT', 'LATE', 'ON_CLOCK')} tone="green" hint={`of ${rows.length} employees`} />
        <Stat label="Late" value={count('LATE')} tone={count('LATE') ? 'amber' : undefined} />
        <Stat label="Absent" value={count('ABSENT')} tone={count('ABSENT') ? 'red' : undefined} hint={count('NOT_YET_IN') ? `${count('NOT_YET_IN')} not yet in` : undefined} />
        <Stat label="Incomplete" value={count('INCOMPLETE')} tone={count('INCOMPLETE') ? 'red' : undefined} hint="missing time in or out" />
      </div>

      {flagged > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          <b>⚠ {flagged} time-clock punch{flagged === 1 ? '' : 'es'} to check</b> — made from another employee's login, or from one device for several people within 10 minutes. Hover the red tag next to the time for details.
        </div>
      )}
      <Card title="Daily time record">
        {rows.length === 0 ? <Empty>No active employees. Add employees first.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th><th className="text-right">In</th><th className="text-right">Out</th><th>Day type</th>
                  <th className="text-right">Late</th><th className="text-right">Undertime</th><th className="text-right">Regular</th>
                  <th className="text-right">OT</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ emp, entry: e, status, dayType }) => (
                  <tr key={emp.id} className={status === 'ABSENT' || status === 'INCOMPLETE' ? 'bg-red-50/40' : ''}>
                    <td>
                      <Link href={`/timekeeping?employee=${emp.id}`} className="link">{employeeName(emp)}</Link>
                      <div className="text-[11px] text-slate-500">{emp.position}{emp.status === 'ON_LEAVE' ? ' · on leave' : ''}</div>
                    </td>
                    <td className="text-right whitespace-nowrap">{fmtClock(e?.timeIn)}<Selfie photoId={e?.timeInPhotoId} time={e?.timeIn} source={e?.source} /><Pin lat={e?.timeInLat} lng={e?.timeInLng} accuracy={e?.timeInAccuracy} time={e?.timeIn} source={e?.source} shop={shop} /><Flag reasons={e ? flags.get(e.id)?.in : undefined} cleared={e ? flags.get(e.id)?.cleared : undefined} /></td>
                    <td className="text-right whitespace-nowrap"><TimeOutCell date={date} timeOut={e?.timeOut ?? null} /><Selfie photoId={e?.timeOutPhotoId} time={e?.timeOut} source={e?.source} /><Pin lat={e?.timeOutLat} lng={e?.timeOutLng} accuracy={e?.timeOutAccuracy} time={e?.timeOut} source={e?.source} shop={shop} /><Flag reasons={e ? flags.get(e.id)?.out : undefined} cleared={e ? flags.get(e.id)?.cleared : undefined} /></td>
                    <td className="whitespace-nowrap">{DAY_TYPE[dayType]}</td>
                    <td className={`text-right whitespace-nowrap ${e?.lateMinutes ? 'text-amber-700' : ''}`}>{fmtMinutes(e?.lateMinutes ?? 0)}</td>
                    <td className={`text-right whitespace-nowrap ${e?.undertimeMinutes ? 'text-amber-700' : ''}`}>{fmtMinutes(e?.undertimeMinutes ?? 0)}</td>
                    <td className="text-right whitespace-nowrap">{fmtMinutes(e?.regularMinutes ?? 0)}</td>
                    <td className="text-right whitespace-nowrap"><OtCell minutes={e?.overtimeMinutes ?? 0} approved={!!e?.otApproved} /></td>
                    <td className="whitespace-nowrap"><DtrStatusBadge status={status} /></td>
                    <td className="whitespace-nowrap text-right">
                      {locked.has(emp.id)
                        ? <span className="text-[11px] uppercase tracking-wide text-slate-400" title="Inside a finalized / paid payroll">Locked</span>
                        : <Link href={`/timekeeping/entry?employee=${emp.id}&date=${date}`} className="link text-[12px]">{e ? 'Edit' : 'Add'}</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

/* ─────────────── Range view: one employee, every date in range ─────────────── */

async function RangeView({ employeeId, from: fromQ, to: toQ }: { employeeId: number; from?: string; to?: string }) {
  const shop = await shopPoint();
  const emp: Employee | null = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) notFound();
  const month = monthRange(todayManila());
  let from = isDateStr(fromQ) ? fromQ : month.from;
  let to = isDateStr(toQ) ? toQ : month.to;
  if (to < from) [from, to] = [to, from];
  if (parseDateInput(to)!.getTime() - parseDateInput(from)!.getTime() > 92 * 86_400_000) to = addDays(from, 92);

  const { rows, totals, locks } = await buildDtr(emp, from, to);
  const qs = `employee=${emp.id}&from=${from}&to=${to}`;
  const prevMonth = monthRange(addDays(from, -1));
  const nextMonth = monthRange(addDays(monthRange(from).to, 1));

  return (
    <>
      <Card
        title={<>{employeeName(emp, true)} <span className="font-normal normal-case tracking-normal text-slate-500">· {emp.employeeNo}</span></>}
        actions={<Link href={`/employees/${emp.id}`} className="link text-[12px]">Employee profile →</Link>}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[13px] text-slate-600">
            {emp.position} · {fmtHHMM(emp.shiftStart)}–{fmtHHMM(emp.shiftEnd)} ({emp.breakMinutes} min break), {workDaysLabel(emp.workDays)}
            <div className="mt-0.5 text-[12px] text-slate-500">Period: {fmtDate(parseDateInput(from))} – {fmtDate(parseDateInput(to))}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/timekeeping?employee=${emp.id}&from=${prevMonth.from}&to=${prevMonth.to}`} className="btn-secondary btn-sm">← Prev month</Link>
            <Link href={`/timekeeping?employee=${emp.id}&from=${nextMonth.from}&to=${nextMonth.to}`} className="btn-secondary btn-sm">Next month →</Link>
            <Link href={`/print/dtr?${qs}`} className="btn-dark btn-sm">Print DTR</Link>
            {totals.otUnapproved > 0 && (
              <ActionForm action={approveAllOt.bind(null, emp.id, from, to)} confirm={`Approve all unapproved overtime (${fmtMinutes(totals.otUnapproved)}) from ${from} to ${to}?`}>
                <SubmitButton className="btn-primary btn-sm">Approve all OT in range</SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
      </Card>

      <DtrTotalsStats totals={totals} />

      {locks.length > 0 && (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
          Locked (finalized / paid payroll): {locks.map((l) => `${l.runNo} ${l.from} – ${l.to}`).join('; ')}. These days can&apos;t be edited.
        </p>
      )}

      <Card title="Daily time record">
        <DtrTable rows={rows} showPhotos shop={shop} flags={await punchFlags(rows.map((r) => r.entry).filter((e): e is NonNullable<typeof e> => !!e))} editHref={(d) => `/timekeeping/entry?employee=${emp.id}&date=${d}`} />
      </Card>
      <p className="text-[12px] text-slate-500">Absent = a work day with no time record. Overtime is only paid once approved (✓).</p>
    </>
  );
}
