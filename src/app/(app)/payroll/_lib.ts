// Payroll UI helpers (safe on server and client: no Prisma, no server-only imports).
import { peso } from '@/lib/money';
import { addDays, todayManila } from '@/lib/dates';
import { isoWeekday } from '@/lib/timekeeping';

/** Line codes subtracted from earnings to get gross (see src/lib/payroll.ts). */
export const ATTENDANCE_CODES = ['ABSENCES', 'LATE_UNDERTIME'];

/** Codes counted as "basic salary" for 13th-month pay. */
export const THIRTEENTH_PLUS = ['BASIC', 'LEAVE'];
export const THIRTEENTH_MINUS = ['ABSENCES', 'LATE_UNDERTIME'];

export type PeriodPreset = { label: string; from: string; to: string; payDate: string };

const monthFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' });
function monthLabel(ym: string) {
  return monthFmt.format(new Date(`${ym}-01T00:00:00Z`));
}

function lastDayOfMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function halves(ym: string): PeriodPreset[] {
  const last = lastDayOfMonth(ym);
  const label = monthLabel(ym);
  return [
    { label: `1–15 ${label}`, from: `${ym}-01`, to: `${ym}-15`, payDate: `${ym}-15` },
    { label: `16–${last} ${label}`, from: `${ym}-16`, to: `${ym}-${last}`, payDate: `${ym}-${last}` },
  ];
}

/** Period presets computed in Manila time. Weekly weeks run Mon–Sun, paid on Saturday. */
export function periodPresets(today: string = todayManila()): { SEMI_MONTHLY: PeriodPreset[]; WEEKLY: PeriodPreset[] } {
  const ym = today.slice(0, 7);
  const monday = addDays(today, 1 - isoWeekday(today));
  const lastMonday = addDays(monday, -7);
  const week = (mon: string, label: string): PeriodPreset => ({
    label: `${label} (${mon.slice(5)} – ${addDays(mon, 6).slice(5)})`,
    from: mon,
    to: addDays(mon, 6),
    payDate: addDays(mon, 5),
  });
  return {
    SEMI_MONTHLY: [...halves(ym), ...halves(prevMonth(ym))],
    WEEKLY: [week(monday, 'This week Mon–Sun'), week(lastMonday, 'Last week Mon–Sun')],
  };
}

export function rateLabel(payType: string, rate: number) {
  return payType === 'MONTHLY' ? `${peso(rate)}/mo` : `${peso(rate)}/day`;
}

export function fmtHours(h: number) {
  return h ? h.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

export function fmtNum(n: number) {
  return n ? n.toLocaleString('en-PH', { maximumFractionDigits: 2 }) : '—';
}

export const FREQ_SHORT: Record<string, string> = { WEEKLY: 'Weekly', SEMI_MONTHLY: 'Semi-monthly' };

type LineLike = { kind: string; code: string };
/** Split payslip lines into the three display groups. */
export function groupLines<T extends LineLike>(lines: T[]) {
  return {
    earnings: lines.filter((l) => l.kind === 'EARNING'),
    attendance: lines.filter((l) => l.kind === 'DEDUCTION' && ATTENDANCE_CODES.includes(l.code)),
    deductions: lines.filter((l) => l.kind === 'DEDUCTION' && !ATTENDANCE_CODES.includes(l.code)),
  };
}

export function sum<T>(rows: T[], f: (r: T) => number) {
  return rows.reduce((s, r) => s + f(r), 0);
}
