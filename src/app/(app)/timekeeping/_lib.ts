import 'server-only';
import type { Employee, HolidayType, TimeEntry } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { parseDateInput, toDateInput, todayManila } from '@/lib/dates';
import { datesBetween, dayTypeFor } from '@/lib/timekeeping';
import { dtrStatus, employedOn, weekdayShort, type DtrStatus } from './_dtr';

type Db = Tx | typeof prisma;

export type LockedPeriod = { runNo: string; status: string; from: string; to: string };

/** FINALIZED / PAID payroll runs with a payslip for this employee overlapping [from, to]. */
export async function lockedPeriods(db: Db, employeeId: number, from: string, to: string): Promise<LockedPeriod[]> {
  const slips = await db.payslip.findMany({
    where: {
      employeeId,
      run: { status: { in: ['FINALIZED', 'PAID'] }, periodStart: { lte: parseDateInput(to)! }, periodEnd: { gte: parseDateInput(from)! } },
    },
    select: { run: { select: { runNo: true, status: true, periodStart: true, periodEnd: true } } },
  });
  return slips.map((s) => ({ runNo: s.run.runNo, status: s.run.status, from: toDateInput(s.run.periodStart), to: toDateInput(s.run.periodEnd) }));
}

export function lockFor(periods: LockedPeriod[], dateStr: string): LockedPeriod | undefined {
  return periods.find((p) => dateStr >= p.from && dateStr <= p.to);
}

/** Error message when a date is inside a finalized/paid payroll of the employee, else null. */
export async function lockReason(db: Db, employeeId: number, dateStr: string): Promise<string | null> {
  const p = lockFor(await lockedPeriods(db, employeeId, dateStr, dateStr), dateStr);
  return p ? `This day is part of payroll ${p.runNo} (${p.status.toLowerCase()}, ${p.from} to ${p.to}). Time records in a finalized or paid payroll can't be changed — void the payroll run first if a correction is really needed.` : null;
}

export type DtrRow = {
  date: string; weekday: string; entry: TimeEntry | null; holiday: { name: string; type: HolidayType } | null;
  dayType: TimeEntry['dayType']; status: DtrStatus; locked: boolean;
};

export type DtrTotals = {
  present: number; paidLeave: number; absent: number; incomplete: number; late: number;
  regularMinutes: number; lateMinutes: number; undertimeMinutes: number; otApproved: number; otUnapproved: number;
};

/** Every date in the range with its time entry (if any), holiday, status and totals. */
export async function buildDtr(emp: Employee, from: string, to: string) {
  const start = parseDateInput(from)!;
  const end = parseDateInput(to)!;
  const endEx = new Date(end.getTime() + 86_400_000);
  const [entries, holidays, locks] = await Promise.all([
    prisma.timeEntry.findMany({ where: { employeeId: emp.id, workDate: { gte: start, lt: endEx } } }),
    prisma.holiday.findMany({ where: { date: { gte: start, lt: endEx } } }),
    lockedPeriods(prisma, emp.id, from, to),
  ]);
  const byDate = new Map(entries.map((e) => [toDateInput(e.workDate), e]));
  const holByDate = new Map(holidays.map((h) => [toDateInput(h.date), h]));
  const today = todayManila();

  const totals: DtrTotals = { present: 0, paidLeave: 0, absent: 0, incomplete: 0, late: 0, regularMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, otApproved: 0, otUnapproved: 0 };
  const rows: DtrRow[] = datesBetween(start, end).map((date) => {
    const entry = byDate.get(date) ?? null;
    const h = holByDate.get(date);
    const status = dtrStatus(emp, date, today, entry, h?.type, employedOn(emp, date));
    if (status === 'PRESENT' || status === 'LATE' || status === 'ON_CLOCK') totals.present++;
    if (status === 'LATE') totals.late++;
    if (status === 'PAID_LEAVE') totals.paidLeave++;
    if (status === 'ABSENT') totals.absent++;
    if (status === 'INCOMPLETE') totals.incomplete++;
    if (entry) {
      totals.regularMinutes += entry.regularMinutes;
      totals.lateMinutes += entry.lateMinutes;
      totals.undertimeMinutes += entry.undertimeMinutes;
      if (entry.otApproved) totals.otApproved += entry.overtimeMinutes;
      else totals.otUnapproved += entry.overtimeMinutes;
    }
    return {
      date, weekday: weekdayShort(date), entry, holiday: h ? { name: h.name, type: h.type } : null,
      dayType: entry?.dayType ?? dayTypeFor(emp, date, h?.type), status, locked: !!lockFor(locks, date),
    };
  });
  return { rows, totals, locks };
}
