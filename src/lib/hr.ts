import 'server-only';
import bcrypt from 'bcryptjs';
import type { DayType, Employee, TimeSource } from '@prisma/client';
import { prisma, type Tx } from './db';
import { getSettings } from './settings';
import { parseDateInput, toDateInput, todayManila } from './dates';
import { computeEntry, dayTypeFor, fmtClock, fmtSlot, overbreakMinutes, parseBreakSchedule } from './timekeeping';

export function employeeName(e: Pick<Employee, 'firstName' | 'lastName' | 'nickname'>, withNick = false) {
  return `${e.firstName} ${e.lastName}${withNick && e.nickname ? ` (${e.nickname})` : ''}`;
}

/** Next employee number EMP-0001 (not reset yearly). Call inside the creating transaction. */
export async function nextEmployeeNo(tx: Tx): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "counters" ("key", "value") VALUES ('EMP', 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "counters"."value" + 1
    RETURNING "value"`;
  return `EMP-${String(rows[0].value).padStart(4, '0')}`;
}

export async function graceMinutes(): Promise<number> {
  const n = Number((await getSettings()).late_grace_minutes);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** The employee's own grace period when set, otherwise the shop default. */
export function graceFor(employee: Pick<Employee, 'lateGraceMinutes'>, shopGrace: number): number {
  return employee.lateGraceMinutes != null && employee.lateGraceMinutes >= 0 ? employee.lateGraceMinutes : shopGrace;
}

/** Over-break minutes of an entry from its break punches and the shop's break schedule. */
async function entryOverbreak(tx: Tx, employee: Employee, entryId: number | null, workDate: Date, timeOut: Date | null) {
  if (!entryId) return 0;
  const breaks = await tx.timeBreak.findMany({ where: { entryId }, select: { startAt: true, endAt: true } });
  if (breaks.length === 0) return 0;
  const slots = parseBreakSchedule((await getSettings()).break_schedule);
  return overbreakMinutes(workDate, breaks, slots, employee.breakMinutes, timeOut);
}

export async function holidayOn(db: Tx | typeof prisma, dateStr: string) {
  return db.holiday.findUnique({ where: { date: parseDateInput(dateStr)! } });
}

type EntryFields = {
  timeIn?: Date | null; timeOut?: Date | null; breakMinutes?: number; dayType?: DayType | null;
  otApproved?: boolean; notes?: string | null; source: TimeSource; userId: number | null;
};

/**
 * Create or update one employee-day, recomputing late/undertime/OT/regular minutes.
 * dayType defaults to the holiday calendar / rest-day rule when not given.
 */
export async function upsertTimeEntry(tx: Tx, employee: Employee, dateStr: string, f: EntryFields, grace?: number) {
  const workDate = parseDateInput(dateStr);
  if (!workDate) throw new Error('Invalid date.');
  const existing = await tx.timeEntry.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
  const holiday = await holidayOn(tx, dateStr);
  const dayType = f.dayType ?? existing?.dayType ?? dayTypeFor(employee, dateStr, holiday?.type);
  const timeIn = f.timeIn !== undefined ? f.timeIn : existing?.timeIn ?? null;
  const timeOut = f.timeOut !== undefined ? f.timeOut : existing?.timeOut ?? null;
  const breakMinutes = f.breakMinutes ?? existing?.breakMinutes ?? employee.breakMinutes;
  if (timeIn && timeOut && timeOut <= timeIn) throw new Error('Time out must be after time in.');
  const overbreak = await entryOverbreak(tx, employee, existing?.id ?? null, workDate, timeOut);
  const minutes = computeEntry(employee, { workDate, timeIn, timeOut, breakMinutes, dayType, overbreakMinutes: overbreak }, graceFor(employee, grace ?? (await graceMinutes())));
  const data = {
    timeIn, timeOut, breakMinutes, dayType, ...minutes, overbreakMinutes: overbreak,
    otApproved: f.otApproved ?? existing?.otApproved ?? false,
    notes: f.notes !== undefined ? f.notes : existing?.notes ?? null,
  };
  return existing
    ? tx.timeEntry.update({ where: { id: existing.id }, data: { ...data, source: f.source === 'MANUAL' ? 'MANUAL' : existing.source, updatedById: f.userId } })
    : tx.timeEntry.create({ data: { ...data, employeeId: employee.id, workDate, source: f.source, createdById: f.userId } });
}

/** Recompute the stored minutes of an existing entry (e.g. after a schedule change). */
export async function recomputeEntry(tx: Tx, employee: Employee, entryId: number, grace: number) {
  const e = await tx.timeEntry.findUniqueOrThrow({ where: { id: entryId } });
  const overbreak = await entryOverbreak(tx, employee, e.id, e.workDate, e.timeOut);
  const minutes = computeEntry(employee, { ...e, overbreakMinutes: overbreak }, graceFor(employee, grace));
  return tx.timeEntry.update({ where: { id: e.id }, data: { ...minutes, overbreakMinutes: overbreak } });
}

/** Verify a time-clock PIN. Locks the employee's PIN for 5 minutes after 5 wrong tries. */
export async function verifyPin(employeeId: number, pin: string) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp || emp.status === 'RESIGNED' || emp.status === 'TERMINATED') throw new Error('Employee not found.');
  if (!emp.pinHash) throw new Error('No PIN set yet. Ask the admin to set your time-clock PIN.');
  if (emp.pinLockedUntil && emp.pinLockedUntil > new Date()) {
    throw new Error(`Too many wrong PINs. Try again after ${fmtClock(emp.pinLockedUntil)}.`);
  }
  if (!(await bcrypt.compare(pin, emp.pinHash))) {
    const fails = emp.pinFailedCount + 1;
    await prisma.employee.update({
      where: { id: emp.id },
      data: fails >= 5 ? { pinFailedCount: 0, pinLockedUntil: new Date(Date.now() + 5 * 60_000) } : { pinFailedCount: fails },
    });
    throw new Error(fails >= 5 ? 'Too many wrong PINs. Locked for 5 minutes.' : 'Wrong PIN.');
  }
  if (emp.pinFailedCount || emp.pinLockedUntil) {
    await prisma.employee.update({ where: { id: emp.id }, data: { pinFailedCount: 0, pinLockedUntil: null } });
  }
  return emp;
}

export type PunchResult = { action: 'IN' | 'OUT'; at: Date; name: string; workDate: string; lateMinutes: number };

/**
 * Time-clock punch: first punch of the day = time in, second = time out.
 * An open entry from yesterday (overnight shift, < 16 h old) is closed instead.
 */
export async function clockPunch(tx: Tx, emp: Employee, userId: number | null): Promise<PunchResult> {
  const now = new Date();
  const today = todayManila();
  const name = employeeName(emp);
  const grace = await graceMinutes();

  const open = await tx.timeEntry.findFirst({
    where: { employeeId: emp.id, timeIn: { not: null }, timeOut: null, workDate: { gte: new Date(parseDateInput(today)!.getTime() - 86_400_000) } },
    orderBy: { workDate: 'desc' },
  });
  if (open && open.timeIn) {
    const sinceIn = now.getTime() - open.timeIn.getTime();
    if (sinceIn < 60_000) throw new Error(`${name}: already timed in at ${fmtClock(open.timeIn)}.`);
    if (toDateInput(open.workDate) === today || sinceIn < 16 * 3_600_000) {
      // Timing out while on break ends the break at the same moment.
      await tx.timeBreak.updateMany({ where: { entryId: open.id, endAt: null }, data: { endAt: now, endByUserId: userId } });
      const e = await upsertTimeEntry(tx, emp, toDateInput(open.workDate), { timeOut: now, source: 'CLOCK', userId }, grace);
      return { action: 'OUT', at: now, name, workDate: toDateInput(open.workDate), lateMinutes: e.lateMinutes };
    }
  }

  const todayEntry = await tx.timeEntry.findUnique({ where: { employeeId_workDate: { employeeId: emp.id, workDate: parseDateInput(today)! } } });
  if (todayEntry?.timeIn && todayEntry.timeOut) {
    throw new Error(`${name}: already timed out today at ${fmtClock(todayEntry.timeOut)}. Ask the admin if this is wrong.`);
  }
  if (todayEntry?.dayType === 'PAID_LEAVE') throw new Error(`${name}: today is marked as paid leave. Ask the admin to change it first.`);
  const e = await upsertTimeEntry(tx, emp, today, { timeIn: now, source: 'CLOCK', userId }, grace);
  return { action: 'IN', at: now, name, workDate: today, lateMinutes: e.lateMinutes };
}

export type BreakResult = { action: 'BREAK_START' | 'BREAK_END'; at: Date; name: string; minutes: number; overMinutes: number; slot: string | null };

/**
 * Time-clock break punch: starts a break, or ends the open one. Needs an open time-in (today, or an overnight shift).
 * The entry's minutes are recomputed so over-break shows as undertime right away.
 */
export async function clockBreak(tx: Tx, emp: Employee, userId: number | null, deviceId: string | null): Promise<BreakResult> {
  const now = new Date();
  const today = todayManila();
  const name = employeeName(emp);
  const open = await tx.timeEntry.findFirst({
    where: { employeeId: emp.id, timeIn: { not: null }, timeOut: null, workDate: { gte: new Date(parseDateInput(today)!.getTime() - 86_400_000) } },
    orderBy: { workDate: 'desc' },
  });
  if (!open?.timeIn || (toDateInput(open.workDate) !== today && now.getTime() - open.timeIn.getTime() >= 16 * 3_600_000)) {
    throw new Error(`${name}: time in first before taking a break.`);
  }
  const onBreak = await tx.timeBreak.findFirst({ where: { entryId: open.id, endAt: null }, orderBy: { startAt: 'desc' } });
  const slots = parseBreakSchedule((await getSettings()).break_schedule);
  const slotOf = (at: Date) => {
    const m = Math.round((at.getTime() - open.workDate.getTime()) / 60_000);
    let best: (typeof slots)[number] | null = null, dist = Infinity;
    for (const sl of slots) { const d = m < sl.start ? sl.start - m : m > sl.end ? m - sl.end : 0; if (d < dist) { dist = d; best = sl; } }
    return best;
  };
  if (onBreak) {
    if (now.getTime() - onBreak.startAt.getTime() < 30_000) throw new Error(`${name}: break started just now at ${fmtClock(onBreak.startAt)}.`);
    await tx.timeBreak.update({ where: { id: onBreak.id }, data: { endAt: now, endByUserId: userId } });
    await recomputeEntry(tx, emp, open.id, await graceMinutes());
    const minutes = Math.round((now.getTime() - onBreak.startAt.getTime()) / 60_000);
    const sl = slotOf(onBreak.startAt);
    const allowed = sl ? sl.end - sl.start : emp.breakMinutes;
    return { action: 'BREAK_END', at: now, name, minutes, overMinutes: Math.max(0, minutes - allowed), slot: sl ? fmtSlot(sl) : null };
  }
  if ((await tx.timeBreak.count({ where: { entryId: open.id } })) >= 8) throw new Error(`${name}: too many breaks today. Ask the admin.`);
  await tx.timeBreak.create({ data: { entryId: open.id, startAt: now, startByUserId: userId, deviceId } });
  const sl = slotOf(now);
  return { action: 'BREAK_START', at: now, name, minutes: 0, overMinutes: 0, slot: sl ? fmtSlot(sl) : null };
}
