// Helpers for the Employees module (safe on server and client).
import { peso } from '@/lib/money';
import { WEEKDAYS } from '@/lib/labels';

type Pay = { payType: string; rate: number; workDays: string };
type Sched = { shiftStart: string; shiftEnd: string; workDays: string };

export const DEDUCTION_SUGGESTIONS = ['SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding tax', 'Loan'];

export function workDayNumbers(workDays: string): number[] {
  return workDays.split(',').map((d) => Number(d.trim())).filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
}

/** "1,2,3,4,5,6" -> "Mon–Sat"; "1,3,5" -> "Mon, Wed, Fri" */
export function workDaysLabel(workDays: string): string {
  const days = workDayNumbers(workDays);
  if (days.length === 0) return '—';
  if (days.length === 7) return 'Daily';
  const name = (n: number) => WEEKDAYS.find(([d]) => d === n)?.[1] ?? String(n);
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive && days.length >= 3) return `${name(days[0])}–${name(days[days.length - 1])}`;
  return days.map(name).join(', ');
}

/** "08:00–17:00 · Mon–Sat" */
export function scheduleLabel(e: Sched): string {
  return `${e.shiftStart}–${e.shiftEnd} · ${workDaysLabel(e.workDays)}`;
}

/** "₱550.00 / day" or "₱15,000.00 / month" */
export function rateLabel(e: Pick<Pay, 'payType' | 'rate'>): string {
  return `${peso(e.rate)} / ${e.payType === 'MONTHLY' ? 'month' : 'day'}`;
}

/** Average work days per month for a weekly schedule (days/week × 52.1667 ÷ 12). */
export function workDaysPerMonth(workDays: string): number {
  return (Math.max(1, workDayNumbers(workDays).length) * 52.1667) / 12;
}

/** Estimated monthly pay in centavos: monthly salary, or daily rate × average work days per month. */
export function monthlyEstimate(e: Pay): number {
  return e.payType === 'MONTHLY' ? e.rate : Math.round(e.rate * workDaysPerMonth(e.workDays));
}

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
