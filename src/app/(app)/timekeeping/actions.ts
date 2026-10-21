'use server';

import { revalidatePath } from 'next/cache';
import type { DayType, Employee, HolidayType, TimeEntry } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { addDays, parseDateInput, toDateInput } from '@/lib/dates';
import { employeeName, graceMinutes, upsertTimeEntry } from '@/lib/hr';
import { DAY_TYPE, dayTypeFor, fmtClock, parseClockInput } from '@/lib/timekeeping';
import { lockedPeriods, lockFor, lockReason } from './_lib';

const ADMIN = 'hr' as const; // HR permission (employees, timekeeping, payroll)
const DAY_TYPES = Object.keys(DAY_TYPE) as DayType[];

function snapshot(e: TimeEntry | null) {
  if (!e) return null;
  return {
    timeIn: e.timeIn?.toISOString() ?? null, timeOut: e.timeOut?.toISOString() ?? null, breakMinutes: e.breakMinutes,
    dayType: e.dayType, otApproved: e.otApproved, notes: e.notes, regularMinutes: e.regularMinutes,
    lateMinutes: e.lateMinutes, undertimeMinutes: e.undertimeMinutes, overtimeMinutes: e.overtimeMinutes,
  };
}

function revalidateTk() {
  revalidatePath('/timekeeping');
  revalidatePath('/timekeeping/entry');
  revalidatePath('/clock');
  revalidatePath('/me');
}

async function loadDay(tx: Tx, employeeId: number, dateStr: string) {
  const workDate = parseDateInput(dateStr);
  if (!workDate) throw new Error('Invalid date.');
  const emp = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new Error('Employee not found.');
  const locked = await lockReason(tx, emp.id, dateStr);
  if (locked) throw new Error(locked);
  const existing = await tx.timeEntry.findUnique({ where: { employeeId_workDate: { employeeId: emp.id, workDate } } });
  return { emp, existing };
}

/* ───────────────────────── Time entries ───────────────────────── */

export async function saveEntry(employeeId: number, dateStr: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const inStr = str(fd, 'timeIn');
    const outStr = str(fd, 'timeOut');
    const nextDay = fd.get('outNextDay') === 'on';
    const dayType = str(fd, 'dayType') as DayType;
    if (!DAY_TYPES.includes(dayType)) throw new Error('Choose a day type.');
    const breakMinutes = Number.parseInt(str(fd, 'breakMinutes'), 10);
    if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes > 600) throw new Error('Break minutes must be between 0 and 600.');
    const reason = str(fd, 'reason');
    const notes = optStr(fd, 'notes');
    const otApproved = fd.get('otApproved') === 'on';

    const leave = dayType === 'PAID_LEAVE';
    const timeIn = leave ? null : parseClockInput(dateStr, inStr);
    const timeOut = leave ? null : parseClockInput(nextDay ? addDays(dateStr, 1) : dateStr, outStr);
    if (!leave && inStr && !timeIn) throw new Error('Invalid time in.');
    if (!leave && outStr && !timeOut) throw new Error('Invalid time out.');
    if (timeIn && timeOut && timeOut <= timeIn) {
      throw new Error(nextDay ? 'Time out must be after time in.' : 'Time out is before time in. Tick "Time out is the next day" for an overnight shift.');
    }

    await prisma.$transaction(async (tx) => {
      const { emp, existing } = await loadDay(tx, employeeId, dateStr);
      if (existing && !reason) throw new Error('Enter the reason for changing this time record.');
      const saved = await upsertTimeEntry(tx, emp, dateStr, { timeIn, timeOut, breakMinutes, dayType, otApproved, notes, source: 'MANUAL', userId: user.id });
      const desc = leave ? 'paid leave' : `${fmtClock(timeIn)} – ${fmtClock(timeOut)}`;
      await audit(
        tx, user.id, existing ? 'UPDATE' : 'CREATE', 'TimeEntry', saved.id,
        `${existing ? 'Edited' : 'Added'} time record of ${employeeName(emp)} for ${dateStr} (${desc})${reason ? ` — ${reason}` : ''}`,
        { employeeId: emp.id, date: dateStr, reason: reason || null, before: snapshot(existing), after: snapshot(saved) },
      );
    });
    revalidateTk();
    return { ok: 'Time record saved.' };
  });
}

export async function markPaidLeave(employeeId: number, dateStr: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const reason = str(fd, 'reason');
    await prisma.$transaction(async (tx) => {
      const { emp, existing } = await loadDay(tx, employeeId, dateStr);
      if (existing && !reason) throw new Error('Enter the reason for changing this time record.');
      const saved = await upsertTimeEntry(tx, emp, dateStr, { timeIn: null, timeOut: null, dayType: 'PAID_LEAVE', otApproved: false, source: 'MANUAL', userId: user.id });
      await audit(tx, user.id, existing ? 'UPDATE' : 'CREATE', 'TimeEntry', saved.id,
        `Marked ${employeeName(emp)} as paid leave on ${dateStr}${reason ? ` — ${reason}` : ''}`,
        { employeeId: emp.id, date: dateStr, reason: reason || null, before: snapshot(existing), after: snapshot(saved) });
    });
    revalidateTk();
    return { ok: 'Marked as paid leave.' };
  });
}

export async function clearEntry(employeeId: number, dateStr: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const reason = str(fd, 'reason');
    if (!reason) throw new Error('Enter the reason for clearing this time record.');
    await prisma.$transaction(async (tx) => {
      const { emp, existing } = await loadDay(tx, employeeId, dateStr);
      if (!existing) throw new Error('There is no time record to clear.');
      await tx.timeEntry.delete({ where: { id: existing.id } });
      await audit(tx, user.id, 'DELETE', 'TimeEntry', existing.id, `Cleared time record of ${employeeName(emp)} for ${dateStr} — ${reason}`,
        { employeeId: emp.id, date: dateStr, reason, before: snapshot(existing) });
    });
    revalidateTk();
    return { ok: 'Time record cleared.' };
  });
}

/** Admin reviewed a flagged punch (buddy-punching check) and found it OK. The flag turns grey and leaves the alerts. */
export async function clearPunchFlags(entryId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const note = String(fd.get('note') ?? '').trim().slice(0, 300) || null;
    await prisma.$transaction(async (tx) => {
      const e = await tx.timeEntry.findUniqueOrThrow({ where: { id: entryId }, include: { employee: { select: { firstName: true, lastName: true } } } });
      await tx.timeEntry.update({ where: { id: entryId }, data: { flagsClearedAt: new Date(), flagsClearedById: user.id, flagsClearNote: note } });
      await audit(tx, user.id, 'UPDATE', 'TimeEntry', entryId, `Time-clock flag marked as checked for ${e.employee.firstName} ${e.employee.lastName} (${toDateInput(e.workDate)})${note ? `: ${note}` : ''}`, { note });
    });
    revalidatePath('/timekeeping'); revalidatePath('/dashboard');
    return { ok: 'Marked as checked. The tag is now grey and it no longer counts as an alert.' };
  });
}

export async function reopenPunchFlags(entryId: number, _prev: ActionState): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    await prisma.$transaction(async (tx) => {
      const e = await tx.timeEntry.findUniqueOrThrow({ where: { id: entryId }, include: { employee: { select: { firstName: true, lastName: true } } } });
      await tx.timeEntry.update({ where: { id: entryId }, data: { flagsClearedAt: null, flagsClearedById: null, flagsClearNote: null } });
      await audit(tx, user.id, 'UPDATE', 'TimeEntry', entryId, `Time-clock flag re-opened for ${e.employee.firstName} ${e.employee.lastName} (${toDateInput(e.workDate)})`);
    });
    revalidatePath('/timekeeping'); revalidatePath('/dashboard');
    return { ok: 'Flag re-opened.' };
  });
}

export async function approveAllOt(employeeId: number, from: string, to: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const start = parseDateInput(from), end = parseDateInput(to);
    if (!start || !end || end < start) throw new Error('Invalid date range.');
    const count = await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
      const locks = await lockedPeriods(tx, emp.id, from, to);
      const entries = await tx.timeEntry.findMany({
        where: { employeeId: emp.id, workDate: { gte: start, lt: new Date(end.getTime() + 86_400_000) }, overtimeMinutes: { gt: 0 }, otApproved: false },
      });
      const ids = entries.filter((e) => !lockFor(locks, toDateInput(e.workDate))).map((e) => e.id);
      if (!ids.length) return 0;
      await tx.timeEntry.updateMany({ where: { id: { in: ids } }, data: { otApproved: true, updatedById: user.id } });
      await audit(tx, user.id, 'APPROVE_OT', 'Employee', emp.id, `Approved overtime of ${employeeName(emp)} on ${ids.length} day(s), ${from} to ${to}`,
        { from, to, entryIds: ids });
      return ids.length;
    });
    revalidateTk();
    return { ok: count ? `Overtime approved on ${count} day${count === 1 ? '' : 's'}.` : 'No unapproved overtime in this range (locked payroll periods are skipped).' };
  });
}

/* ───────────────────────── Holidays ───────────────────────── */

const RETYPE: DayType[] = ['REGULAR', 'REST_DAY', 'REGULAR_HOLIDAY', 'SPECIAL_HOLIDAY'];

/**
 * Re-derive the day type of existing entries on a date after a holiday change (not paid leave,
 * not entries inside a finalized/paid payroll). Returns how many were updated / skipped.
 */
async function retypeEntriesOn(tx: Tx, dateStr: string, type: HolidayType | null, grace: number) {
  const entries = await tx.timeEntry.findMany({
    where: { workDate: parseDateInput(dateStr)!, dayType: { in: RETYPE } },
    include: { employee: true },
  });
  let updated = 0, skipped = 0;
  for (const e of entries) {
    const emp: Employee = e.employee;
    const dayType = dayTypeFor(emp, dateStr, type);
    if (dayType === e.dayType) continue;
    if (await lockReason(tx, emp.id, dateStr)) { skipped++; continue; }
    // source 'CLOCK' keeps the entry's existing source (this is a recalculation, not a manual edit).
    await upsertTimeEntry(tx, emp, dateStr, { dayType, source: 'CLOCK', userId: null }, grace);
    updated++;
  }
  return { updated, skipped };
}

function retypeNote(r: { updated: number; skipped: number }) {
  const parts = [];
  if (r.updated) parts.push(`${r.updated} time record(s) updated`);
  if (r.skipped) parts.push(`${r.skipped} skipped (finalized payroll)`);
  return parts.length ? ` ${parts.join(', ')}.` : '';
}

function readHoliday(fd: FormData) {
  const dateStr = str(fd, 'date');
  if (!parseDateInput(dateStr)) throw new Error('Enter the holiday date.');
  const name = str(fd, 'name');
  if (!name) throw new Error('Enter the holiday name.');
  const type = str(fd, 'type') as HolidayType;
  if (type !== 'REGULAR' && type !== 'SPECIAL') throw new Error('Choose the holiday type.');
  return { dateStr, name, type };
}

export async function createHoliday(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const { dateStr, name, type } = readHoliday(fd);
    const grace = await graceMinutes();
    const r = await prisma.$transaction(async (tx) => {
      if (await tx.holiday.findUnique({ where: { date: parseDateInput(dateStr)! } })) throw new Error(`There is already a holiday on ${dateStr}.`);
      const h = await tx.holiday.create({ data: { date: parseDateInput(dateStr)!, name, type } });
      const r = await retypeEntriesOn(tx, dateStr, type, grace);
      await audit(tx, user.id, 'CREATE', 'Holiday', h.id, `Added holiday ${name} (${dateStr}, ${type.toLowerCase()})`, { date: dateStr, name, type, ...r });
      return r;
    });
    revalidateTk();
    revalidatePath('/timekeeping/holidays');
    return { ok: `Holiday added.${retypeNote(r)}` };
  });
}

export async function updateHoliday(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const { dateStr, name, type } = readHoliday(fd);
    const grace = await graceMinutes();
    const r = await prisma.$transaction(async (tx) => {
      const before = await tx.holiday.findUniqueOrThrow({ where: { id } });
      const oldDate = toDateInput(before.date);
      if (oldDate !== dateStr && (await tx.holiday.findUnique({ where: { date: parseDateInput(dateStr)! } }))) {
        throw new Error(`There is already a holiday on ${dateStr}.`);
      }
      await tx.holiday.update({ where: { id }, data: { date: parseDateInput(dateStr)!, name, type } });
      const r = { updated: 0, skipped: 0 };
      if (oldDate !== dateStr) {
        const o = await retypeEntriesOn(tx, oldDate, null, grace);
        r.updated += o.updated; r.skipped += o.skipped;
      }
      if (oldDate !== dateStr || before.type !== type) {
        const n = await retypeEntriesOn(tx, dateStr, type, grace);
        r.updated += n.updated; r.skipped += n.skipped;
      }
      await audit(tx, user.id, 'UPDATE', 'Holiday', id, `Updated holiday ${name} (${dateStr})`, {
        before: { date: oldDate, name: before.name, type: before.type }, after: { date: dateStr, name, type }, ...r,
      });
      return r;
    });
    revalidateTk();
    revalidatePath('/timekeeping/holidays');
    return { ok: `Holiday saved.${retypeNote(r)}` };
  });
}

export async function deleteHoliday(id: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const grace = await graceMinutes();
    const r = await prisma.$transaction(async (tx) => {
      const h = await tx.holiday.findUniqueOrThrow({ where: { id } });
      const dateStr = toDateInput(h.date);
      await tx.holiday.delete({ where: { id } });
      const r = await retypeEntriesOn(tx, dateStr, null, grace);
      await audit(tx, user.id, 'DELETE', 'Holiday', id, `Deleted holiday ${h.name} (${dateStr})`, { date: dateStr, name: h.name, type: h.type, ...r });
      return r;
    });
    revalidateTk();
    revalidatePath('/timekeeping/holidays');
    return { ok: `Holiday deleted.${retypeNote(r)}` };
  });
}

const PH_2026: [string, string, HolidayType][] = [
  ['2026-01-01', "New Year's Day", 'REGULAR'],
  ['2026-04-02', 'Maundy Thursday', 'REGULAR'],
  ['2026-04-03', 'Good Friday', 'REGULAR'],
  ['2026-04-09', 'Araw ng Kagitingan', 'REGULAR'],
  ['2026-05-01', 'Labor Day', 'REGULAR'],
  ['2026-06-12', 'Independence Day', 'REGULAR'],
  ['2026-08-31', 'National Heroes Day', 'REGULAR'],
  ['2026-11-30', 'Bonifacio Day', 'REGULAR'],
  ['2026-12-25', 'Christmas Day', 'REGULAR'],
  ['2026-12-30', 'Rizal Day', 'REGULAR'],
  ['2026-02-25', 'EDSA People Power Revolution Anniversary', 'SPECIAL'],
  ['2026-04-04', 'Black Saturday', 'SPECIAL'],
  ['2026-08-21', 'Ninoy Aquino Day', 'SPECIAL'],
  ['2026-11-01', "All Saints' Day", 'SPECIAL'],
  ['2026-11-02', "All Souls' Day", 'SPECIAL'],
  ['2026-12-08', 'Feast of the Immaculate Conception', 'SPECIAL'],
  ['2026-12-24', 'Christmas Eve', 'SPECIAL'],
  ['2026-12-31', 'Last Day of the Year', 'SPECIAL'],
];

export async function seedPhHolidays2026(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const grace = await graceMinutes();
    const res = await prisma.$transaction(async (tx) => {
      const existing = await tx.holiday.findMany({ where: { date: { gte: parseDateInput('2026-01-01')!, lt: parseDateInput('2027-01-01')! } } });
      const taken = new Set(existing.map((h) => toDateInput(h.date)));
      const added: string[] = [];
      const r = { updated: 0, skipped: 0 };
      for (const [date, name, type] of PH_2026) {
        if (taken.has(date)) continue;
        await tx.holiday.create({ data: { date: parseDateInput(date)!, name, type } });
        const x = await retypeEntriesOn(tx, date, type, grace);
        r.updated += x.updated; r.skipped += x.skipped;
        added.push(`${date} ${name}`);
      }
      if (added.length) await audit(tx, user.id, 'CREATE', 'Holiday', '2026', `Added ${added.length} Philippine holidays for 2026`, { added, ...r });
      return { added: added.length, r };
    }, { timeout: 30_000 });
    revalidateTk();
    revalidatePath('/timekeeping/holidays');
    return { ok: res.added ? `Added ${res.added} holiday(s).${retypeNote(res.r)}` : 'All 2026 holidays in the list already exist.' };
  });
}
