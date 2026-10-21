// Asia/Manila is UTC+8 with no daylight saving, so day boundaries are simple offsets.
export const TZ = 'Asia/Manila';
const OFFSET = '+08:00';

const dateFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-PH', {
  timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return dateFmt.format(new Date(d));
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return dateTimeFmt.format(new Date(d));
}

/** Date -> "YYYY-MM-DD" in Manila time (for <input type="date"> values). */
export function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return '';
  return isoFmt.format(new Date(d));
}

/** Today's date in Manila as "YYYY-MM-DD". */
export function todayManila(): string {
  return isoFmt.format(new Date());
}

/** "YYYY-MM-DD" -> Date at 00:00 Manila. Returns null for empty/invalid. */
export function parseDateInput(s: FormDataEntryValue | string | null | undefined): Date | null {
  if (!s) return null;
  const str = String(s).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(`${str}T00:00:00${OFFSET}`);
  return isNaN(d.getTime()) ? null : d;
}

/** Start (inclusive) and end (exclusive) of a Manila day. */
export function manilaDayRange(s: string = todayManila()): { start: Date; end: Date } {
  const start = parseDateInput(s)!;
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** Inclusive date-range from two "YYYY-MM-DD" strings -> [start, end) Dates. */
export function manilaRange(from: string, to: string): { start: Date; end: Date } {
  return { start: manilaDayRange(from).start, end: manilaDayRange(to).end };
}

export function startOfMonthManila(): string {
  return todayManila().slice(0, 8) + '01';
}

export function addDays(dateStr: string, days: number): string {
  const d = parseDateInput(dateStr)!;
  return toDateInput(new Date(d.getTime() + days * 86_400_000));
}

export function manilaYear(d: Date = new Date()): number {
  return Number(isoFmt.format(d).slice(0, 4));
}

/** Whole days between two instants (b - a), floored. */
export function daysBetween(a: Date, b: Date = new Date()): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/** True if a due date (Manila midnight) is before today in Manila. */
export function isOverdue(due: Date | null | undefined): boolean {
  if (!due) return false;
  return toDateInput(due) < todayManila();
}
