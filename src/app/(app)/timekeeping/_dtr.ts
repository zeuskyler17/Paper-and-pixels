// Pure DTR helpers shared by /timekeeping, /me and /print/dtr (safe on server and client).
import type { DayType, HolidayType, PayFrequency } from '@prisma/client';
import type { Tone } from '@/lib/labels';
import { WEEKDAYS } from '@/lib/labels';
import { addDays, toDateInput } from '@/lib/dates';
import { dayTypeFor, workDaySet } from '@/lib/timekeeping';

export type DtrStatus = 'PRESENT' | 'LATE' | 'INCOMPLETE' | 'ABSENT' | 'REST_DAY' | 'HOLIDAY' | 'PAID_LEAVE' | 'NOT_YET_IN' | 'ON_CLOCK' | 'NONE';

export const DTR_STATUS: Record<DtrStatus, { label: string; tone: Tone }> = {
  PRESENT: { label: 'Present', tone: 'green' },
  LATE: { label: 'Late', tone: 'amber' },
  INCOMPLETE: { label: 'Incomplete', tone: 'red' },
  ABSENT: { label: 'Absent', tone: 'red' },
  REST_DAY: { label: 'Rest day', tone: 'gray' },
  HOLIDAY: { label: 'Holiday', tone: 'purple' },
  PAID_LEAVE: { label: 'Paid leave', tone: 'blue' },
  NOT_YET_IN: { label: 'Not yet in', tone: 'gray' },
  ON_CLOCK: { label: 'Timed in', tone: 'green' },
  NONE: { label: '—', tone: 'gray' },
};

export type EntryLike = {
  timeIn: Date | null; timeOut: Date | null; dayType: DayType;
  lateMinutes: number; undertimeMinutes: number; regularMinutes: number; overtimeMinutes: number; otApproved: boolean;
};

export type EmployeeLike = { workDays: string; hireDate: Date; endDate: Date | null };

export function employedOn(e: Pick<EmployeeLike, 'hireDate' | 'endDate'>, dateStr: string) {
  return dateStr >= toDateInput(e.hireDate) && (!e.endDate || dateStr <= toDateInput(e.endDate));
}

/**
 * Status of one employee-day.
 *  - entry present: paid leave / present / late / incomplete (time in only today = still on the clock)
 *  - no entry: holiday, rest day, not yet in (today), absent (past work day), nothing (future / not employed)
 */
export function dtrStatus(
  emp: Pick<EmployeeLike, 'workDays'>, dateStr: string, today: string, entry: EntryLike | null | undefined,
  holiday: HolidayType | null | undefined, employed = true,
): DtrStatus {
  if (entry) {
    if (entry.dayType === 'PAID_LEAVE') return 'PAID_LEAVE';
    if (entry.timeIn && entry.timeOut) return entry.lateMinutes > 0 ? 'LATE' : 'PRESENT';
    // Timed in today and not out yet = still at work.
    if (entry.timeIn && !entry.timeOut && dateStr === today) return entry.lateMinutes > 0 ? 'LATE' : 'ON_CLOCK';
    if (entry.timeIn || entry.timeOut) return 'INCOMPLETE';
    // Entry with no times (e.g. a day-type override only) – fall through like no record.
  }
  if (!employed) return 'NONE';
  const dt = entry?.dayType ?? dayTypeFor(emp, dateStr, holiday);
  if (dt === 'REGULAR_HOLIDAY' || dt === 'SPECIAL_HOLIDAY') return 'HOLIDAY';
  if (dt === 'REST_DAY') return 'REST_DAY';
  if (dateStr > today) return 'NONE';
  if (dateStr === today) return 'NOT_YET_IN';
  return 'ABSENT';
}

export function weekdayShort(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[(d + 6) % 7][1];
}

/** "1,2,3,4,5,6" -> "Mon–Sat"; irregular sets are listed. */
export function workDaysLabel(workDays: string) {
  const days = [...workDaySet({ workDays })].sort((a, b) => a - b);
  if (!days.length) return '—';
  const name = (n: number) => WEEKDAYS[n - 1][1];
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  return contiguous && days.length > 2 ? `${name(days[0])}–${name(days[days.length - 1])}` : days.map(name).join(', ');
}

/** "08:00" -> "8:00 AM" */
export function fmtHHMM(s: string) {
  const [h, m] = s.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return s;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function lastDayOfMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Pay period containing a date: semi-monthly 1–15 / 16–end, weekly Mon–Sun. */
export function payPeriodFor(freq: PayFrequency, dateStr: string): { from: string; to: string } {
  if (freq === 'WEEKLY') {
    const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
    const from = addDays(dateStr, -((d + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  const [y, m, day] = dateStr.split('-').map(Number);
  const ym = dateStr.slice(0, 8);
  return day <= 15 ? { from: `${ym}01`, to: `${ym}15` } : { from: `${ym}16`, to: `${ym}${String(lastDayOfMonth(y, m)).padStart(2, '0')}` };
}

/** The current pay period and the `count - 1` before it, newest first. */
export function recentPayPeriods(freq: PayFrequency, today: string, count = 12) {
  const out: { from: string; to: string }[] = [];
  let p = payPeriodFor(freq, today);
  for (let i = 0; i < count; i++) {
    out.push(p);
    p = payPeriodFor(freq, addDays(p.from, -1));
  }
  return out;
}

export function monthRange(dateStr: string) {
  const [y, m] = dateStr.split('-').map(Number);
  const ym = dateStr.slice(0, 8);
  return { from: `${ym}01`, to: `${ym}${String(lastDayOfMonth(y, m)).padStart(2, '0')}` };
}

export const isDateStr = (s: string | undefined | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
