'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { DeductionSchedule, EmploymentStatus, IncidentSeverity, IncidentType, PayFrequency, PayType, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, optInt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { toCentavos } from '@/lib/money';
import { parseDateInput, toDateInput } from '@/lib/dates';
import { employeeName, graceMinutes, nextEmployeeNo, recomputeEntry } from '@/lib/hr';
import { dayTypeFor, hhmmToMinutes } from '@/lib/timekeeping';
import {
  CASH_ADVANCE_STATUS, DEDUCTION_SCHEDULE, EMPLOYMENT_STATUS, INCIDENT_SEVERITY, INCIDENT_TYPE, PAY_FREQUENCY, PAY_TYPE,
} from '@/lib/labels';
import { HHMM, workDayNumbers } from './_lib';
import { createLoginTx, readLoginInput } from '@/lib/logins';

const ADMIN = 'hr' as const; // HR permission (employees, timekeeping, payroll)
const admin = () => assertUser(ADMIN);

/** Plain JSON for audit payloads (Dates -> ISO strings). */
function j(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
}

function oneOf<T extends string>(v: string, labels: Record<string, string>, what: string): T {
  if (!(v in labels)) throw new Error(`Choose a valid ${what}.`);
  return v as T;
}

function reqDate(fd: FormData, key: string, label: string): Date {
  const d = parseDateInput(str(fd, key));
  if (!d) throw new Error(`${label} is required.`);
  return d;
}

function money(fd: FormData, key: string, label: string): number {
  const v = toCentavos(str(fd, key));
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be more than ₱0.00.`);
  return v;
}

// ───────────────────────── Employee profile ─────────────────────────

async function readEmployee(fd: FormData, tx: Tx, selfId: number | null) {
  const firstName = str(fd, 'firstName');
  const lastName = str(fd, 'lastName');
  const position = str(fd, 'position');
  if (!firstName || !lastName) throw new Error('First and last name are required.');
  if (!position) throw new Error('Position is required.');

  const hireDate = reqDate(fd, 'hireDate', 'Hire date');
  const status = oneOf<EmploymentStatus>(str(fd, 'status') || 'ACTIVE', EMPLOYMENT_STATUS, 'status');
  const separated = status === 'RESIGNED' || status === 'TERMINATED';
  let endDate: Date | null = null;
  if (separated) {
    endDate = parseDateInput(str(fd, 'endDate'));
    if (!endDate) throw new Error(`End date is required when the status is ${EMPLOYMENT_STATUS[status]}.`);
    if (endDate < hireDate) throw new Error('End date cannot be before the hire date.');
  }

  const payType = oneOf<PayType>(str(fd, 'payType'), PAY_TYPE, 'pay type');
  const rate = money(fd, 'rate', payType === 'MONTHLY' ? 'Monthly salary' : 'Daily rate');
  const payFrequency = oneOf<PayFrequency>(str(fd, 'payFrequency'), PAY_FREQUENCY, 'pay frequency');

  const shiftStart = str(fd, 'shiftStart');
  const shiftEnd = str(fd, 'shiftEnd');
  if (!HHMM.test(shiftStart) || !HHMM.test(shiftEnd)) throw new Error('Shift start and end must be valid times (HH:MM).');
  if (shiftStart === shiftEnd) throw new Error('Shift start and end cannot be the same time.');
  const breakMinutes = optInt(fd, 'breakMinutes') ?? 0;
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0) throw new Error('Break minutes must be 0 or more.');
  let span = hhmmToMinutes(shiftEnd) - hhmmToMinutes(shiftStart);
  if (span <= 0) span += 24 * 60;
  if (span - breakMinutes < 60) throw new Error('The break is too long for this shift (at least 1 hour of work is needed).');

  const lateGraceMinutes = optInt(fd, 'lateGraceMinutes');
  if (lateGraceMinutes !== null && (!Number.isInteger(lateGraceMinutes) || lateGraceMinutes < 0 || lateGraceMinutes > 120)) throw new Error('Late grace must be 0–120 minutes, or empty for the shop default.');

  const days = [...new Set(fd.getAll('workDays').map((v) => Number(v)))].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (days.length === 0) throw new Error('Pick at least one work day.');
  const workDays = days.join(',');

  const email = optStr(fd, 'email');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Email address looks invalid.');

  const birthDate = parseDateInput(str(fd, 'birthDate'));
  if (str(fd, 'birthDate') && !birthDate) throw new Error('Birth date is invalid.');

  const userId = optInt(fd, 'userId');
  if (userId !== null) {
    const u = await tx.user.findUnique({ where: { id: userId }, include: { employee: { select: { id: true, firstName: true, lastName: true, nickname: true } } } });
    if (!u) throw new Error('The selected login no longer exists.');
    if (u.employee && u.employee.id !== selfId) throw new Error(`Login "${u.username}" is already linked to ${employeeName(u.employee)}.`);
  }

  return {
    firstName, lastName, middleName: optStr(fd, 'middleName'), nickname: optStr(fd, 'nickname'), position,
    mobile: optStr(fd, 'mobile'), email, address: optStr(fd, 'address'), birthDate, hireDate, status, endDate,
    payType, rate, payFrequency, shiftStart, shiftEnd, breakMinutes, workDays, lateGraceMinutes,
    sssNo: optStr(fd, 'sssNo'), philhealthNo: optStr(fd, 'philhealthNo'), pagibigNo: optStr(fd, 'pagibigNo'), tin: optStr(fd, 'tin'),
    emergencyContact: optStr(fd, 'emergencyContact'), emergencyPhone: optStr(fd, 'emergencyPhone'),
    notes: optStr(fd, 'notes'), userId,
  };
}

/** New employee + their login, in one step. Only admins may create logins, so only admins may add employees. */
export async function createEmployee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await attempt(async () => {
    const user = await assertUser('admin');
    const login = readLoginInput(fd, 'login_');
    const emp = await prisma.$transaction(async (tx) => {
      const data = await readEmployee(fd, tx, null);
      const account = await createLoginTx(tx, user.id, [data.firstName, data.lastName].join(' ').trim(), login);
      const employeeNo = await nextEmployeeNo(tx);
      const e = await tx.employee.create({ data: { ...data, userId: account.id, employeeNo } });
      await audit(tx, user.id, 'CREATE', 'Employee', e.id, `Added employee ${employeeNo} ${employeeName(e)} · login ${account.username}`, j({ employeeNo, ...data, userId: account.id }));
      return e;
    });
    id = emp.id;
  });
  if (res?.error) return res;
  redirect(`/employees/${id}`);
}

/** "Create login" on an employee who has none (older records). Admin only. */
export async function createLoginForEmployee(employeeId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('admin');
    const login = readLoginInput(fd, 'login_');
    const username = await prisma.$transaction(async (tx) => {
      const e = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
      if (e.userId) throw new Error('This employee already has a login.');
      const account = await createLoginTx(tx, user.id, employeeName(e), login);
      await tx.employee.update({ where: { id: employeeId }, data: { userId: account.id } });
      await audit(tx, user.id, 'UPDATE', 'Employee', employeeId, `Created login ${account.username} for ${employeeName(e)}`, { userId: account.id });
      return account.username;
    });
    revalidatePath(`/employees/${employeeId}`); revalidatePath('/employees'); revalidatePath('/users');
    return { ok: `Login "${username}" created and linked. Give them the password and ask them to change it under My account.` };
  });
}

export async function updateEmployee(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    const grace = await graceMinutes();
    const wantRecompute = str(fd, 'recompute') === '1';
    const from = parseDateInput(str(fd, 'recomputeFrom'));

    const recomputed = await prisma.$transaction(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { pinHash, ...before } = await tx.employee.findUniqueOrThrow({ where: { id } });
      const data = await readEmployee(fd, tx, id);
      const scheduleChanged = before.shiftStart !== data.shiftStart || before.shiftEnd !== data.shiftEnd
        || before.breakMinutes !== data.breakMinutes || before.workDays !== data.workDays || before.lateGraceMinutes !== data.lateGraceMinutes;
      const updated = await tx.employee.update({ where: { id }, data });

      let count = 0;
      if (scheduleChanged && wantRecompute) {
        if (!from) throw new Error('Pick the date to recompute time records from.');
        const workDaysChanged = before.workDays !== data.workDays;
        const breakChanged = before.breakMinutes !== data.breakMinutes;
        const entries = await tx.timeEntry.findMany({ where: { employeeId: id, workDate: { gte: from } }, orderBy: { workDate: 'asc' } });
        for (const e of entries) {
          const patch: Prisma.TimeEntryUpdateInput = {};
          // Rest day / regular day follows the new work days (holidays and paid leave are kept).
          if (workDaysChanged && (e.dayType === 'REGULAR' || e.dayType === 'REST_DAY')) {
            const t = dayTypeFor(updated, toDateInput(e.workDate), null);
            if (t !== e.dayType) patch.dayType = t;
          }
          // Entries still using the old default break get the new one.
          if (breakChanged && e.breakMinutes === before.breakMinutes) patch.breakMinutes = data.breakMinutes;
          if (Object.keys(patch).length) await tx.timeEntry.update({ where: { id: e.id }, data: { ...patch, updatedById: user.id } });
          await recomputeEntry(tx, updated, e.id, grace);
          count++;
        }
      }

      await audit(tx, user.id, 'UPDATE', 'Employee', id, `Updated employee ${updated.employeeNo} ${employeeName(updated)}`
        + (count ? ` (recomputed ${count} time record(s) from ${toDateInput(from)})` : ''), j({ before, after: data }));
      return count;
    }, { timeout: 30_000 });

    revalidatePath(`/employees/${id}`);
    revalidatePath('/employees');
    return { ok: recomputed ? `Employee saved. Recomputed ${recomputed} time record(s).` : 'Employee saved.' };
  });
}

// ───────────────────────── Time-clock PIN ─────────────────────────

export async function setPin(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    const pin = str(fd, 'pin');
    const confirm = str(fd, 'pinConfirm');
    if (!/^\d{4,6}$/.test(pin)) throw new Error('The PIN must be 4 to 6 digits (numbers only).');
    if (/^(\d)\1+$/.test(pin)) throw new Error('The PIN cannot be the same digit repeated (e.g. 0000). Choose another.');
    if (pin !== confirm) throw new Error('The two PINs do not match.');

    const emp = await prisma.employee.findUniqueOrThrow({ where: { id } });
    const others = await prisma.employee.findMany({
      where: { id: { not: id }, status: { in: ['ACTIVE', 'ON_LEAVE'] }, pinHash: { not: null } },
      select: { pinHash: true },
    });
    for (const o of others) {
      if (o.pinHash && (await bcrypt.compare(pin, o.pinHash))) {
        throw new Error('Another employee already uses this PIN. Choose a different one to avoid confusion at the time clock.');
      }
    }
    const pinHash = await bcrypt.hash(pin, 10);
    await prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { pinHash, pinFailedCount: 0, pinLockedUntil: null } });
      await audit(tx, user.id, 'UPDATE', 'Employee', id, `${emp.pinHash ? 'Reset' : 'Set'} time-clock PIN for ${employeeName(emp)} (PIN changed)`);
    });
    revalidatePath(`/employees/${id}`);
    revalidatePath('/employees');
    return { ok: 'PIN saved. Tell the employee their new PIN privately.' };
  });
}

export async function unlockPin(id: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.update({ where: { id }, data: { pinFailedCount: 0, pinLockedUntil: null } });
      await audit(tx, user.id, 'UPDATE', 'Employee', id, `Unlocked time-clock PIN for ${employeeName(emp)}`);
    });
    revalidatePath(`/employees/${id}`);
    return { ok: 'PIN unlocked.' };
  });
}

// ───────────────────────── Recurring deductions ─────────────────────────

function readDeduction(fd: FormData) {
  const name = str(fd, 'name');
  if (!name) throw new Error('Deduction name is required.');
  return {
    name,
    amount: money(fd, 'amount', 'Amount'),
    schedule: oneOf<DeductionSchedule>(str(fd, 'schedule') || 'EVERY_PAYROLL', DEDUCTION_SCHEDULE, 'schedule'),
    notes: optStr(fd, 'notes'),
  };
}

export async function addDeduction(employeeId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    const data = readDeduction(fd);
    await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
      const d = await tx.recurringDeduction.create({ data: { ...data, employeeId } });
      await audit(tx, user.id, 'CREATE', 'RecurringDeduction', d.id, `Added deduction ${d.name} for ${employeeName(emp)}`, j(data));
    });
    revalidatePath(`/employees/${employeeId}`);
    return { ok: 'Deduction added.' };
  });
}

export async function updateDeduction(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    const data = readDeduction(fd);
    const employeeId = await prisma.$transaction(async (tx) => {
      const before = await tx.recurringDeduction.findUniqueOrThrow({ where: { id } });
      await tx.recurringDeduction.update({ where: { id }, data });
      await audit(tx, user.id, 'UPDATE', 'RecurringDeduction', id, `Updated deduction ${data.name}`, j({ before, after: data }));
      return before.employeeId;
    });
    revalidatePath(`/employees/${employeeId}`);
    return { ok: 'Deduction saved.' };
  });
}

export async function toggleDeduction(id: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    const d = await prisma.$transaction(async (tx) => {
      const before = await tx.recurringDeduction.findUniqueOrThrow({ where: { id } });
      const d = await tx.recurringDeduction.update({ where: { id }, data: { active: !before.active } });
      await audit(tx, user.id, 'UPDATE', 'RecurringDeduction', id, `${d.active ? 'Reactivated' : 'Deactivated'} deduction ${d.name}`);
      return d;
    });
    revalidatePath(`/employees/${d.employeeId}`);
    return { ok: d.active ? 'Deduction reactivated.' : 'Deduction deactivated.' };
  });
}

export async function deleteDeduction(id: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    const employeeId = await prisma.$transaction(async (tx) => {
      const d = await tx.recurringDeduction.findUniqueOrThrow({ where: { id } });
      const used = await tx.payslipLine.count({ where: { recurringDeductionId: id } });
      if (used > 0) throw new Error(`"${d.name}" was already used on ${used} payslip line(s), so it can't be deleted. Deactivate it instead.`);
      await tx.recurringDeduction.delete({ where: { id } });
      await audit(tx, user.id, 'DELETE', 'RecurringDeduction', id, `Deleted unused deduction ${d.name}`, j(d));
      return d.employeeId;
    });
    revalidatePath(`/employees/${employeeId}`);
    return { ok: 'Deduction deleted.' };
  });
}

// ───────────────────────── Cash advances ─────────────────────────

export async function addCashAdvance(employeeId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    const date = reqDate(fd, 'date', 'Date');
    const amount = money(fd, 'amount', 'Amount');
    const installment = str(fd, 'installment') === '' ? amount : money(fd, 'installment', 'Installment per payroll');
    if (installment > amount) throw new Error('The installment per payroll cannot be more than the amount.');
    const reason = optStr(fd, 'reason');
    await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
      const ca = await tx.cashAdvance.create({
        data: { employeeId, date, amount, installment, balance: amount, reason, status: 'OPEN', createdById: user.id },
      });
      await audit(tx, user.id, 'CREATE', 'CashAdvance', ca.id, `Cash advance for ${employeeName(emp)}`, j({ date, amount, installment, reason }));
    });
    revalidatePath(`/employees/${employeeId}`);
    revalidatePath('/employees');
    return { ok: 'Cash advance recorded.' };
  });
}

export async function voidCashAdvance(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    const reason = str(fd, 'reason');
    if (!reason) throw new Error('Please give a reason for voiding.');
    const employeeId = await prisma.$transaction(async (tx) => {
      const ca = await tx.cashAdvance.findUniqueOrThrow({ where: { id } });
      if (ca.status !== 'OPEN') throw new Error(`This cash advance is already ${CASH_ADVANCE_STATUS[ca.status].toLowerCase()}.`);
      const lines = await tx.payslipLine.findMany({
        where: { cashAdvanceId: id, payslip: { run: { status: { not: 'VOID' } } } },
        select: { payslip: { select: { run: { select: { runNo: true, status: true } } } } },
      });
      if (ca.balance !== ca.amount || lines.length > 0) {
        const runs = [...new Set(lines.map((l) => l.payslip.run.runNo))];
        throw new Error(
          'This cash advance can no longer be voided because repayments were already deducted'
          + (runs.length ? ` (payroll ${runs.join(', ')})` : '')
          + '. If a payroll run is still a draft, recalculate or void it first; otherwise let the remaining balance be deducted as usual.',
        );
      }
      await tx.cashAdvance.update({ where: { id }, data: { status: 'VOID', voidReason: reason, balance: 0 } });
      await audit(tx, user.id, 'VOID', 'CashAdvance', id, `Voided cash advance: ${reason}`, j({ amount: ca.amount, reason }));
      return ca.employeeId;
    });
    revalidatePath(`/employees/${employeeId}`);
    revalidatePath('/employees');
    return { ok: 'Cash advance voided.' };
  });
}

// ───────────────────────── Incidents (admin only) ─────────────────────────

function readIncident(fd: FormData) {
  const title = str(fd, 'title');
  const description = str(fd, 'description');
  if (!title) throw new Error('Title is required.');
  if (!description) throw new Error('Description is required.');
  return {
    date: reqDate(fd, 'date', 'Date'),
    type: oneOf<IncidentType>(str(fd, 'type'), INCIDENT_TYPE, 'type'),
    severity: oneOf<IncidentSeverity>(str(fd, 'severity') || 'MINOR', INCIDENT_SEVERITY, 'severity'),
    title, description, actionTaken: optStr(fd, 'actionTaken'),
  };
}

export async function addIncident(employeeId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    const data = readIncident(fd);
    await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
      const i = await tx.incident.create({ data: { ...data, employeeId, createdById: user.id } });
      await audit(tx, user.id, 'CREATE', 'Incident', i.id, `Logged ${INCIDENT_TYPE[data.type].toLowerCase()} for ${employeeName(emp)}: ${data.title}`, j(data));
    });
    revalidatePath(`/employees/${employeeId}`);
    return { ok: 'Record added.' };
  });
}

export async function updateIncident(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await admin();
    const data = readIncident(fd);
    const employeeId = await prisma.$transaction(async (tx) => {
      const before = await tx.incident.findUniqueOrThrow({ where: { id } });
      await tx.incident.update({ where: { id }, data: { ...data, updatedById: user.id } });
      await audit(tx, user.id, 'UPDATE', 'Incident', id, `Edited incident record: ${data.title}`, j({
        before: { date: before.date, type: before.type, severity: before.severity, title: before.title, description: before.description, actionTaken: before.actionTaken },
        after: data,
      }));
      return before.employeeId;
    });
    revalidatePath(`/employees/${employeeId}`);
    return { ok: 'Record saved.' };
  });
}
