'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { PayFrequency, PaymentMethod } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { nextNumber } from '@/lib/counters';
import { peso, toCentavos } from '@/lib/money';
import { parseDateInput, toDateInput } from '@/lib/dates';
import { PAY_FREQUENCY, PAYMENT_METHOD } from '@/lib/labels';
import { buildPayslip, finalizeRun, generateRun, markRunPaid, recalcPayslip, recalcRunTotals, voidRun } from '@/lib/payroll';
import { employeeName } from '@/lib/hr';

const ADMIN = 'hr' as const; // HR permission (employees, timekeeping, payroll)
const TX_OPTS = { timeout: 60_000 };

function revalidateRun(runId: number, payslipId?: number) {
  revalidatePath('/payroll');
  revalidatePath(`/payroll/${runId}`);
  if (payslipId) revalidatePath(`/payroll/${runId}/payslips/${payslipId}`);
}

async function draftRun(tx: Tx, runId: number) {
  const run = await tx.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error('Payroll run not found.');
  if (run.status !== 'DRAFT') throw new Error('This payroll run is no longer a draft — it cannot be changed.');
  return run;
}

async function draftPayslip(tx: Tx, payslipId: number) {
  const p = await tx.payslip.findUnique({ where: { id: payslipId }, include: { run: true, employee: true } });
  if (!p) throw new Error('Payslip not found.');
  if (p.run.status !== 'DRAFT') throw new Error('This payroll run is no longer a draft — the payslip cannot be changed.');
  return p;
}

function warningText(warnings: { employee: string; messages: string[] }[]) {
  if (!warnings.length) return '';
  return ` Check: ${warnings.map((w) => `${w.employee} — ${w.messages.join('; ')}`).join(' · ')}`;
}

// ───────── runs ─────────

export async function createRun(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let runId = 0;
  const res = await attempt(async () => {
    const user = await assertUser(ADMIN);
    const frequency = str(fd, 'frequency');
    if (!Object.prototype.hasOwnProperty.call(PAY_FREQUENCY, frequency)) return { error: 'Choose the pay frequency.' };
    const fromStr = str(fd, 'from'), toStr = str(fd, 'to');
    const from = parseDateInput(fromStr), to = parseDateInput(toStr);
    const payDate = parseDateInput(str(fd, 'payDate'));
    if (!from || !to) return { error: 'Enter the period start and end dates.' };
    if (from > to) return { error: 'The period start must be on or before the period end.' };
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 31) return { error: `The period is ${days} days long. A payroll period can be at most 31 days.` };
    if (!payDate) return { error: 'Enter the pay date.' };

    const overlap = await prisma.payrollRun.findFirst({
      where: { frequency: frequency as PayFrequency, status: { not: 'VOID' }, periodStart: { lte: to }, periodEnd: { gte: from } },
      orderBy: { periodStart: 'asc' },
    });
    if (overlap) {
      return { error: `This period overlaps payroll ${overlap.runNo} (${toDateInput(overlap.periodStart)} to ${toDateInput(overlap.periodEnd)}, ${overlap.status.toLowerCase()}). Void that run first or pick another period.` };
    }

    const run = await prisma.$transaction(async (tx) => {
      const runNo = await nextNumber(tx, 'PR');
      const run = await tx.payrollRun.create({
        data: { runNo, frequency: frequency as PayFrequency, periodStart: from, periodEnd: to, payDate, notes: optStr(fd, 'notes'), createdById: user.id },
      });
      const r = await generateRun(tx, run.id);
      await audit(tx, user.id, 'CREATE', 'PayrollRun', run.id, `Created payroll ${runNo} (${fromStr} to ${toStr}) with ${r.count} payslip(s)`, { frequency, from: fromStr, to: toStr, payDate: toDateInput(payDate) });
      return run;
    }, TX_OPTS);
    runId = run.id;
  });
  if (res?.error) return res;
  revalidatePath('/payroll');
  redirect(`/payroll/${runId}`);
}

export async function recalcRun(runId: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const r = await prisma.$transaction(async (tx) => {
      const run = await draftRun(tx, runId);
      const r = await generateRun(tx, runId);
      await audit(tx, user.id, 'RECALCULATE', 'PayrollRun', runId, `Recalculated payroll ${run.runNo} from time records (${r.count} payslip(s))`);
      return r;
    }, TX_OPTS);
    revalidateRun(runId);
    return { ok: `Recalculated ${r.count} payslip(s) from the time records.${warningText(r.warnings)}` };
  });
}

export async function finalizeRunAction(runId: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    await prisma.$transaction((tx) => finalizeRun(tx, runId, user.id), TX_OPTS);
    revalidateRun(runId);
    revalidatePath('/employees');
    return { ok: 'Payroll finalized. Cash-advance balances were updated.' };
  });
}

export async function markPaidAction(runId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const via = str(fd, 'paidVia');
    if (!Object.prototype.hasOwnProperty.call(PAYMENT_METHOD, via)) return { error: 'Choose how the salaries were paid.' };
    await prisma.$transaction((tx) => markRunPaid(tx, runId, user.id, via as PaymentMethod), TX_OPTS);
    revalidateRun(runId);
    revalidatePath('/expenses');
    return { ok: 'Marked as paid and recorded as a Salaries expense.' };
  });
}

export async function voidRunAction(runId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const reason = str(fd, 'reason');
    if (!reason) return { error: 'Enter a reason for voiding this payroll run.' };
    await prisma.$transaction((tx) => voidRun(tx, runId, user.id, reason), TX_OPTS);
    revalidateRun(runId);
    revalidatePath('/expenses');
    revalidatePath('/employees');
    return { ok: 'Payroll run voided.' };
  });
}

export async function addEmployeeToRun(runId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const employeeId = Number(str(fd, 'employeeId'));
    if (!employeeId) return { error: 'Choose an employee.' };
    const res = await prisma.$transaction(async (tx) => {
      const run = await draftRun(tx, runId);
      const emp = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!emp) throw new Error('Employee not found.');
      const exists = await tx.payslip.findUnique({ where: { runId_employeeId: { runId, employeeId } } });
      if (exists) throw new Error(`${employeeName(emp)} is already in this payroll run.`);
      const r = await buildPayslip(tx, run, emp);
      await recalcRunTotals(tx, runId);
      await audit(tx, user.id, 'ADD_PAYSLIP', 'PayrollRun', runId, `Added ${employeeName(emp)} (${emp.employeeNo}) to payroll ${run.runNo}`, { payslipId: r.payslipId });
      return { ...r, name: employeeName(emp) };
    }, TX_OPTS);
    revalidateRun(runId);
    return { ok: `Added ${res.name}.${res.warnings.length ? ` Check: ${res.warnings.join('; ')}` : ''}` };
  });
}

export async function removePayslip(payslipId: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const runId = await prisma.$transaction(async (tx) => {
      const p = await draftPayslip(tx, payslipId);
      await tx.payslip.delete({ where: { id: payslipId } });
      await recalcRunTotals(tx, p.runId);
      await audit(tx, user.id, 'REMOVE_PAYSLIP', 'PayrollRun', p.runId, `Removed ${employeeName(p.employee)} (${p.employee.employeeNo}) from draft payroll ${p.run.runNo} — net was ${peso(p.net)}`);
      return p.runId;
    });
    revalidateRun(runId);
    return { ok: 'Removed from this payroll run.' };
  });
}

// ───────── payslips ─────────

export async function recalcPayslipAction(payslipId: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const res = await prisma.$transaction(async (tx) => {
      const p = await draftPayslip(tx, payslipId);
      const r = await buildPayslip(tx, p.run, p.employee);
      await recalcRunTotals(tx, p.runId);
      await audit(tx, user.id, 'RECALCULATE', 'Payslip', payslipId, `Recalculated payslip of ${employeeName(p.employee)} in ${p.run.runNo}`);
      return { runId: p.runId, warnings: r.warnings };
    });
    revalidateRun(res.runId, payslipId);
    return { ok: `Payslip recalculated from the time records.${res.warnings.length ? ` Check: ${res.warnings.join('; ')}` : ''}` };
  });
}

export async function addManualLine(payslipId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const kind = str(fd, 'kind');
    if (kind !== 'EARNING' && kind !== 'DEDUCTION') return { error: 'Choose earning or deduction.' };
    const label = str(fd, 'label');
    if (!label) return { error: 'Enter a description, e.g. “Allowance”.' };
    const amount = toCentavos(fd.get('amount'));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter an amount greater than zero.' };
    const runId = await prisma.$transaction(async (tx) => {
      const p = await draftPayslip(tx, payslipId);
      const line = await tx.payslipLine.create({ data: { payslipId, kind, code: 'MANUAL', label, amount, manual: true } });
      await recalcPayslip(tx, payslipId);
      await recalcRunTotals(tx, p.runId);
      await audit(tx, user.id, 'ADD_LINE', 'Payslip', payslipId, `Added ${kind === 'EARNING' ? 'earning' : 'deduction'} “${label}” ${peso(amount)} to ${employeeName(p.employee)} (${p.run.runNo})`, { lineId: line.id, kind, label, amount });
      return p.runId;
    });
    revalidateRun(runId, payslipId);
    return { ok: 'Line added.' };
  });
}

export async function removeManualLine(lineId: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const res = await prisma.$transaction(async (tx) => {
      const line = await tx.payslipLine.findUnique({ where: { id: lineId } });
      if (!line) throw new Error('Line not found.');
      if (!line.manual) throw new Error('Automatic lines cannot be removed. Fix the time records, then recalculate.');
      const p = await draftPayslip(tx, line.payslipId);
      await tx.payslipLine.delete({ where: { id: lineId } });
      await recalcPayslip(tx, p.id);
      await recalcRunTotals(tx, p.runId);
      await audit(tx, user.id, 'REMOVE_LINE', 'Payslip', p.id, `Removed ${line.kind === 'EARNING' ? 'earning' : 'deduction'} “${line.label}” ${peso(line.amount)} from ${employeeName(p.employee)} (${p.run.runNo})`, { kind: line.kind, label: line.label, amount: line.amount });
      return { runId: p.runId, payslipId: p.id };
    });
    revalidateRun(res.runId, res.payslipId);
    return { ok: 'Line removed.' };
  });
}

export async function updatePayslipNotes(payslipId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN);
    const notes = optStr(fd, 'notes');
    const runId = await prisma.$transaction(async (tx) => {
      const p = await draftPayslip(tx, payslipId);
      await tx.payslip.update({ where: { id: payslipId }, data: { notes } });
      await audit(tx, user.id, 'UPDATE', 'Payslip', payslipId, `Updated notes on payslip of ${employeeName(p.employee)} (${p.run.runNo})`, { notes });
      return p.runId;
    });
    revalidateRun(runId, payslipId);
    return { ok: 'Notes saved.' };
  });
}

