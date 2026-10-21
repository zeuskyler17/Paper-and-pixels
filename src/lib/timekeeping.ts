// Daily time record (DTR) computations. Pure functions — safe on server and client.
// All clock times are Asia/Manila (UTC+8, no DST). A work day is stored as Manila midnight.
import type { DayType, HolidayType } from '@prisma/client';
import { parseDateInput, toDateInput } from './dates';

export type Schedule = { shiftStart: string; shiftEnd: string; breakMinutes: number; workDays: string };

const MIN = 60_000;

/** "08:30" -> 510 */
export function hhmmToMinutes(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Paid minutes in a normal shift, e.g. 08:00–17:00 with 60 min break = 480. */
export function scheduledMinutes(s: Schedule): number {
  let span = hhmmToMinutes(s.shiftEnd) - hhmmToMinutes(s.shiftStart);
  if (span <= 0) span += 24 * 60; // overnight shift
  return Math.max(60, span - (s.breakMinutes || 0));
}

export function workDaySet(s: Pick<Schedule, 'workDays'>): Set<number> {
  return new Set(s.workDays.split(',').map((d) => Number(d.trim())).filter((d) => d >= 1 && d <= 7));
}

/** ISO weekday (1 = Mon … 7 = Sun) of a "YYYY-MM-DD" date. */
export function isoWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Day type for a date: holiday (from the calendar) > rest day (not a work day) > regular. */
export function dayTypeFor(s: Pick<Schedule, 'workDays'>, dateStr: string, holiday?: HolidayType | null): DayType {
  if (holiday === 'REGULAR') return 'REGULAR_HOLIDAY';
  if (holiday === 'SPECIAL') return 'SPECIAL_HOLIDAY';
  return workDaySet(s).has(isoWeekday(dateStr)) ? 'REGULAR' : 'REST_DAY';
}

/** Instant of a "HH:MM" clock time on a Manila work day. */
export function atClock(workDate: Date, hhmm: string): Date {
  return new Date(workDate.getTime() + hhmmToMinutes(hhmm) * MIN);
}

/** Combine a "YYYY-MM-DD" work date and an "HH:MM" time typed by the admin (Manila). */
export function parseClockInput(dateStr: string, hhmm: string | null | undefined): Date | null {
  if (!hhmm) return null;
  const day = parseDateInput(dateStr);
  const mins = hhmmToMinutes(hhmm);
  if (!day || !Number.isFinite(mins)) return null;
  return new Date(day.getTime() + mins * MIN);
}

const hmFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
const hm24 = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false });

/** Date -> "8:02 AM" (Manila) */
export function fmtClock(d: Date | string | null | undefined): string {
  return d ? hmFmt.format(new Date(d)) : '—';
}

/** Date -> "08:02" (Manila) for <input type="time"> */
export function toTimeInput(d: Date | string | null | undefined): string {
  return d ? hm24.format(new Date(d)) : '';
}

/** 135 -> "2h 15m" */
export function fmtMinutes(min: number): string {
  if (!min) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export type EntryInput = { workDate: Date; timeIn: Date | null; timeOut: Date | null; breakMinutes: number; dayType: DayType };
export type EntryMinutes = { regularMinutes: number; lateMinutes: number; undertimeMinutes: number; overtimeMinutes: number };

/**
 * Compute regular / late / undertime / overtime minutes for one day.
 *  - REGULAR day: paid time is clipped to the shift; late within the grace period counts as on time;
 *    overtime = minutes after shift end (paid only once approved).
 *  - Rest day / holiday worked: all worked time counts, up to the scheduled minutes as regular, the rest as OT.
 *  - PAID_LEAVE: a full scheduled day, no times needed.
 *  - Incomplete (missing time in or out): 0 regular minutes until the admin fixes it.
 * The break is only deducted when at least 5 hours were worked.
 */
export function computeEntry(s: Schedule, e: EntryInput, graceMinutes = 0): EntryMinutes {
  const sched = scheduledMinutes(s);
  const zero = { regularMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0 };
  if (e.dayType === 'PAID_LEAVE') return { ...zero, regularMinutes: sched };
  if (!e.timeIn || !e.timeOut || e.timeOut <= e.timeIn) {
    if (e.timeIn && e.dayType === 'REGULAR') {
      const late = Math.max(0, Math.round((e.timeIn.getTime() - atClock(e.workDate, s.shiftStart).getTime()) / MIN));
      return { ...zero, lateMinutes: late > graceMinutes ? late : 0 };
    }
    return zero;
  }
  const brk = (worked: number) => (worked >= 300 ? e.breakMinutes || 0 : 0);

  if (e.dayType !== 'REGULAR') {
    const span = Math.round((e.timeOut.getTime() - e.timeIn.getTime()) / MIN);
    const worked = Math.max(0, span - brk(span));
    return { ...zero, regularMinutes: Math.min(worked, sched), overtimeMinutes: Math.max(0, worked - sched) };
  }

  const start = atClock(e.workDate, s.shiftStart);
  let end = atClock(e.workDate, s.shiftEnd);
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * MIN);

  let late = Math.max(0, Math.round((e.timeIn.getTime() - start.getTime()) / MIN));
  if (late <= graceMinutes) late = 0;
  const overtime = Math.max(0, Math.round((e.timeOut.getTime() - end.getTime()) / MIN));

  const effStart = late === 0 ? start : e.timeIn;
  const effEnd = e.timeOut < end ? e.timeOut : end;
  const within = Math.max(0, Math.round((effEnd.getTime() - effStart.getTime()) / MIN));
  const regular = Math.min(sched, Math.max(0, within - brk(within)));
  // Undertime = scheduled minutes not worked other than lateness (so an unworked lunch break isn't counted).
  const undertime = e.timeOut < end ? Math.max(0, sched - regular - late) : 0;
  return { regularMinutes: regular, lateMinutes: late, undertimeMinutes: undertime, overtimeMinutes: overtime };
}

/** All "YYYY-MM-DD" dates from start to end inclusive (Manila). */
export function datesBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let t = parseDateInput(toDateInput(start))!.getTime(); t <= end.getTime(); t += 86_400_000) out.push(toDateInput(new Date(t)));
  return out;
}

export const DAY_TYPE: Record<DayType, string> = {
  REGULAR: 'Regular day', REST_DAY: 'Rest day', SPECIAL_HOLIDAY: 'Special holiday', REGULAR_HOLIDAY: 'Regular holiday', PAID_LEAVE: 'Paid leave',
};
