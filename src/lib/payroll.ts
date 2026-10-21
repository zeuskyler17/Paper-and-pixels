import 'server-only';
import type { DayType, Employee, PayrollRun, Prisma } from '@prisma/client';
import type { Tx } from './db';
import { addDays, toDateInput } from './dates';
import { audit } from './audit';
import { datesBetween, isoWeekday, scheduledMinutes, workDaySet } from './timekeeping';

/*
 * Payroll rules (Philippine Labor Code defaults, simplified for a small shop):
 *
 *  Daily rate    DAILY: the rate. MONTHLY: monthly × 12 ÷ (work days per week × 52.17) → 313 (6-day) / 261 (5-day).
 *  Per-minute    daily rate ÷ scheduled minutes (e.g. 480).
 *
 *  DAILY-rated   Basic = regular minutes on regular days × per-minute (late/undertime are simply not paid).
 *                Rest day / special holiday worked ×130%, regular holiday worked ×200%,
 *                paid leave = 1 day, unworked regular holiday on a work day = 1 day (holiday pay).
 *  MONTHLY-rated Basic = ½ monthly (semi-monthly) or monthly × 12 ÷ 52 (weekly); prorated by work days
 *                when hired / separated mid-period. Less absences (work days with no time record) and
 *                late/undertime minutes. Premiums on top: rest day worked 130%, special holiday worked +30%,
 *                regular holiday worked +100%.
 *  Overtime      only when approved on the time record: regular day 125%, rest day / special holiday 169%,
 *                regular holiday 260% of the hourly rate.
 *
 *  Gross = earnings − attendance deductions (absences, late/undertime).
 *  Deductions = recurring (SSS, …) + cash-advance installments (capped so net never goes below 0) + manual.
 *  Net = gross − deductions.
 */

const ATTENDANCE_CODES = new Set(['ABSENCES', 'LATE_UNDERTIME']);
const OT_MULT: Record<DayType, number> = { REGULAR: 1.25, REST_DAY: 1.69, SPECIAL_HOLIDAY: 1.69, REGULAR_HOLIDAY: 2.6, PAID_LEAVE: 0 };

export function dailyRateOf(e: Pick<Employee, 'payType' | 'rate' | 'workDays'>): number {
  if (e.payType === 'DAILY') return e.rate;
  const perWeek = Math.max(1, workDaySet(e).size);
  return Math.round((e.rate * 12) / Math.round(perWeek * 52.1667));
}

type LineDraft = { kind: 'EARNING' | 'DEDUCTION'; code: string; label: string; amount: number; quantity?: number | null; recurringDeductionId?: number | null; cashAdvanceId?: number | null };

function employedOn(e: Pick<Employee, 'hireDate' | 'endDate'>, dateStr: string) {
  return dateStr >= toDateInput(e.hireDate) && (!e.endDate || dateStr <= toDateInput(e.endDate));
}

/** Employees that belong in a run: matching pay frequency, employed during the period. */
export async function eligibleEmployees(tx: Tx, run: Pick<PayrollRun, 'frequency' | 'periodStart' | 'periodEnd'>) {
  const end = new Date(run.periodEnd.getTime() + 86_400_000);
  return tx.employee.findMany({
    where: {
      payFrequency: run.frequency,
      hireDate: { lt: end },
      OR: [
        { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
        { endDate: { gte: run.periodStart } },
        { timeEntries: { some: { workDate: { gte: run.periodStart, lt: end } } } },
      ],
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
}

/**
 * (Re)build one employee's payslip in a DRAFT run from the time records. Manual lines added by the
 * admin are kept; automatic lines are replaced. Returns warnings (e.g. incomplete time records).
 */
export async function buildPayslip(tx: Tx, run: PayrollRun, emp: Employee): Promise<{ payslipId: number; warnings: string[] }> {
  const warnings: string[] = [];
  const start = run.periodStart;
  const endEx = new Date(run.periodEnd.getTime() + 86_400_000);
  const [entries, holidays] = await Promise.all([
    tx.timeEntry.findMany({ where: { employeeId: emp.id, workDate: { gte: start, lt: endEx } }, orderBy: { workDate: 'asc' } }),
    tx.holiday.findMany({ where: { date: { gte: start, lt: endEx } } }),
  ]);
  const holidayByDate = new Map(holidays.map((h) => [toDateInput(h.date), h]));
  const entryByDate = new Map(entries.map((e) => [toDateInput(e.workDate), e]));
  const sched = scheduledMinutes(emp);
  const daily = dailyRateOf(emp);
  const perMin = daily / sched;
  const workDays = workDaySet(emp);
  const dates = datesBetween(start, run.periodEnd);
  const lines: LineDraft[] = [];
  const add = (l: LineDraft) => { if (l.amount > 0) lines.push({ ...l, amount: Math.round(l.amount) }); };

  const incomplete = entries.filter((e) => e.dayType !== 'PAID_LEAVE' && (!e.timeIn || !e.timeOut));
  if (incomplete.length) warnings.push(`${incomplete.length} incomplete time record(s): ${incomplete.map((e) => toDateInput(e.workDate)).join(', ')}`);
  const unapprovedOt = entries.filter((e) => e.overtimeMinutes >= 30 && !e.otApproved);
  if (unapprovedOt.length) warnings.push(`${unapprovedOt.length} day(s) with unapproved overtime (not paid)`);

  const sumMin = (t: DayType) => entries.filter((e) => e.dayType === t).reduce((s, e) => s + e.regularMinutes, 0);
  const regularMin = sumMin('REGULAR');
  const restMin = sumMin('REST_DAY');
  const specialMin = sumMin('SPECIAL_HOLIDAY');
  const regHolMin = sumMin('REGULAR_HOLIDAY');
  const leaveDays = entries.filter((e) => e.dayType === 'PAID_LEAVE').length;
  let absentDays = 0;

  if (emp.payType === 'DAILY') {
    add({ kind: 'EARNING', code: 'BASIC', label: 'Basic pay (days worked)', amount: regularMin * perMin, quantity: round2(regularMin / sched) });
    add({ kind: 'EARNING', code: 'REST_DAY', label: 'Rest day work (130%)', amount: restMin * perMin * 1.3, quantity: round2(restMin / sched) });
    add({ kind: 'EARNING', code: 'HOLIDAY', label: 'Special holiday work (130%)', amount: specialMin * perMin * 1.3, quantity: round2(specialMin / sched) });
    add({ kind: 'EARNING', code: 'HOLIDAY', label: 'Regular holiday work (200%)', amount: regHolMin * perMin * 2, quantity: round2(regHolMin / sched) });
    const unworkedRegHol = dates.filter((d) => holidayByDate.get(d)?.type === 'REGULAR' && workDays.has(isoWeekday(d)) && employedOn(emp, d) && !entryByDate.has(d));
    add({ kind: 'EARNING', code: 'HOLIDAY', label: 'Regular holiday pay (unworked)', amount: unworkedRegHol.length * daily, quantity: unworkedRegHol.length });
    absentDays = dates.filter((d) => workDays.has(isoWeekday(d)) && !holidayByDate.has(d) && employedOn(emp, d) && !entryByDate.has(d) && d <= toDateInput(new Date())).length;
  } else {
    const scheduled = dates.filter((d) => workDays.has(isoWeekday(d)) && !holidayByDate.has(d));
    const employed = scheduled.filter((d) => employedOn(emp, d));
    const fullPeriod = employed.length === scheduled.length;
    const basic = fullPeriod ? (run.frequency === 'SEMI_MONTHLY' ? emp.rate / 2 : (emp.rate * 12) / 52) : employed.length * daily;
    add({ kind: 'EARNING', code: 'BASIC', label: fullPeriod ? (run.frequency === 'SEMI_MONTHLY' ? 'Basic pay (½ month)' : 'Basic pay (weekly)') : 'Basic pay (prorated days)', amount: basic, quantity: fullPeriod ? null : employed.length });
    const absent = employed.filter((d) => {
      const e = entryByDate.get(d);
      return !e || (e.dayType !== 'PAID_LEAVE' && e.regularMinutes === 0);
    });
    absentDays = absent.length;
    add({ kind: 'DEDUCTION', code: 'ABSENCES', label: `Absences (${absent.length} day${absent.length === 1 ? '' : 's'})`, amount: absent.length * daily, quantity: absent.length });
    const tardy = entries.filter((e) => e.dayType === 'REGULAR' && e.regularMinutes > 0).reduce((s, e) => s + e.lateMinutes + e.undertimeMinutes, 0);
    add({ kind: 'DEDUCTION', code: 'LATE_UNDERTIME', label: `Late / undertime (${tardy} min)`, amount: tardy * perMin, quantity: tardy });
    add({ kind: 'EARNING', code: 'REST_DAY', label: 'Rest day work (130%)', amount: restMin * perMin * 1.3, quantity: round2(restMin / sched) });
    add({ kind: 'EARNING', code: 'HOLIDAY', label: 'Special holiday premium (+30%)', amount: specialMin * perMin * 0.3, quantity: round2(specialMin / sched) });
    add({ kind: 'EARNING', code: 'HOLIDAY', label: 'Regular holiday premium (+100%)', amount: regHolMin * perMin, quantity: round2(regHolMin / sched) });
  }
  if (emp.payType === 'DAILY') add({ kind: 'EARNING', code: 'LEAVE', label: 'Paid leave', amount: leaveDays * daily, quantity: leaveDays });

  const otEntries = entries.filter((e) => e.otApproved && e.overtimeMinutes > 0);
  const otMin = otEntries.reduce((s, e) => s + e.overtimeMinutes, 0);
  add({ kind: 'EARNING', code: 'OVERTIME', label: 'Overtime (approved)', amount: otEntries.reduce((s, e) => s + e.overtimeMinutes * perMin * OT_MULT[e.dayType], 0), quantity: round2(otMin / 60) });

  // Upsert the payslip and replace automatic lines (keep manual ones).
  const payslip = await tx.payslip.upsert({
    where: { runId_employeeId: { runId: run.id, employeeId: emp.id } },
    create: { runId: run.id, employeeId: emp.id, payType: emp.payType, rate: emp.rate, dailyRate: daily },
    update: { payType: emp.payType, rate: emp.rate, dailyRate: daily },
  });
  await tx.payslipLine.deleteMany({ where: { payslipId: payslip.id, manual: false } });
  const manual = await tx.payslipLine.findMany({ where: { payslipId: payslip.id, manual: true } });

  // Recurring deductions (SSS …). ONCE_A_MONTH: skip if already deducted in another run ending this month.
  const monthStart = toDateInput(run.periodEnd).slice(0, 8) + '01';
  const recurring = await tx.recurringDeduction.findMany({ where: { employeeId: emp.id, active: true }, orderBy: { id: 'asc' } });
  for (const r of recurring) {
    if (r.schedule === 'ONCE_A_MONTH') {
      const already = await tx.payslipLine.count({
        where: {
          recurringDeductionId: r.id,
          payslip: { runId: { not: run.id }, run: { status: { not: 'VOID' }, periodEnd: { gte: new Date(`${monthStart}T00:00:00+08:00`), lt: new Date(`${addDays(monthStart, 32).slice(0, 8)}01T00:00:00+08:00`) } } },
        },
      });
      if (already) continue;
    }
    add({ kind: 'DEDUCTION', code: 'RECURRING', label: r.name, amount: r.amount, recurringDeductionId: r.id });
  }

  // Cash advances: installment, capped by balance and so that net pay stays ≥ 0.
  const earnings = lines.filter((l) => l.kind === 'EARNING').reduce((s, l) => s + l.amount, 0) + manual.filter((l) => l.kind === 'EARNING').reduce((s, l) => s + l.amount, 0);
  let room = earnings - lines.filter((l) => l.kind === 'DEDUCTION').reduce((s, l) => s + l.amount, 0) - manual.filter((l) => l.kind === 'DEDUCTION').reduce((s, l) => s + l.amount, 0);
  const advances = await tx.cashAdvance.findMany({ where: { employeeId: emp.id, status: 'OPEN', balance: { gt: 0 }, date: { lt: endEx } }, orderBy: { date: 'asc' } });
  for (const a of advances) {
    const amt = Math.max(0, Math.min(a.installment, a.balance, room));
    if (amt < a.installment && amt < a.balance) warnings.push(`Cash advance installment reduced to ${(amt / 100).toFixed(2)} so net pay is not negative`);
    if (amt > 0) { add({ kind: 'DEDUCTION', code: 'CASH_ADVANCE', label: `Cash advance (${toDateInput(a.date)}) · bal. ₱${(a.balance / 100).toFixed(2)}`, amount: amt, cashAdvanceId: a.id }); room -= amt; }
  }

  if (lines.length) await tx.payslipLine.createMany({ data: lines.map((l) => ({ ...l, payslipId: payslip.id, quantity: l.quantity ?? null, manual: false })) });

  const daysWorked = entries.filter((e) => e.regularMinutes > 0 && e.dayType !== 'PAID_LEAVE').length;
  await tx.payslip.update({
    where: { id: payslip.id },
    data: {
      daysWorked, regularHours: round2((regularMin + restMin + specialMin + regHolMin) / 60), overtimeHours: round2(otMin / 60),
      lateMinutes: entries.reduce((s, e) => s + e.lateMinutes, 0), undertimeMinutes: entries.reduce((s, e) => s + e.undertimeMinutes, 0), absentDays,
    },
  });
  await recalcPayslip(tx, payslip.id);
  return { payslipId: payslip.id, warnings };
}

/** Recompute gross / deductions / net of a payslip from its lines. */
export async function recalcPayslip(tx: Tx, payslipId: number) {
  const lines = await tx.payslipLine.findMany({ where: { payslipId } });
  const earnings = lines.filter((l) => l.kind === 'EARNING').reduce((s, l) => s + l.amount, 0);
  const attendance = lines.filter((l) => l.kind === 'DEDUCTION' && ATTENDANCE_CODES.has(l.code)).reduce((s, l) => s + l.amount, 0);
  const deductions = lines.filter((l) => l.kind === 'DEDUCTION' && !ATTENDANCE_CODES.has(l.code)).reduce((s, l) => s + l.amount, 0);
  const gross = earnings - attendance;
  return tx.payslip.update({ where: { id: payslipId }, data: { gross, deductions, net: gross - deductions } });
}

export async function recalcRunTotals(tx: Tx, runId: number) {
  const agg = await tx.payslip.aggregate({ where: { runId }, _sum: { gross: true, deductions: true, net: true } });
  return tx.payrollRun.update({
    where: { id: runId },
    data: { totalGross: agg._sum.gross ?? 0, totalDeductions: agg._sum.deductions ?? 0, totalNet: agg._sum.net ?? 0 },
  });
}

/** Build/refresh every payslip of a DRAFT run. */
export async function generateRun(tx: Tx, runId: number) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== 'DRAFT') throw new Error('Only draft payroll runs can be recalculated.');
  const employees = await eligibleEmployees(tx, run);
  const warnings: { employee: string; messages: string[] }[] = [];
  for (const e of employees) {
    const r = await buildPayslip(tx, run, e);
    if (r.warnings.length) warnings.push({ employee: `${e.firstName} ${e.lastName}`, messages: r.warnings });
  }
  await recalcRunTotals(tx, runId);
  return { count: employees.length, warnings };
}

/** Lock the run and apply cash-advance repayments. */
export async function finalizeRun(tx: Tx, runId: number, userId: number) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { payslips: { include: { lines: true } } } });
  if (run.status !== 'DRAFT') throw new Error('This payroll run is not a draft.');
  if (run.payslips.length === 0) throw new Error('There are no payslips in this run.');
  if (run.payslips.some((p) => p.net < 0)) throw new Error('A payslip has a negative net pay. Adjust it before finalizing.');
  for (const p of run.payslips) {
    for (const l of p.lines.filter((x) => x.cashAdvanceId)) {
      const a = await tx.cashAdvance.findUniqueOrThrow({ where: { id: l.cashAdvanceId! } });
      const balance = Math.max(0, a.balance - l.amount);
      await tx.cashAdvance.update({ where: { id: a.id }, data: { balance, status: balance === 0 ? 'PAID' : a.status } });
    }
  }
  await recalcRunTotals(tx, runId);
  const done = await tx.payrollRun.update({ where: { id: runId }, data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedById: userId } });
  await audit(tx, userId, 'FINALIZE', 'PayrollRun', runId, `Finalized payroll ${run.runNo} — net ₱${(done.totalNet / 100).toFixed(2)}`);
  return done;
}

/** Record the payout: creates one expense in "Salaries" so profit reports include payroll. */
export async function markRunPaid(tx: Tx, runId: number, userId: number, paidVia: Prisma.ExpenseCreateInput['paidVia']) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== 'FINALIZED') throw new Error('Finalize the payroll run before marking it paid.');
  let cat = await tx.expenseCategory.findFirst({ where: { name: { equals: 'Salaries', mode: 'insensitive' } } });
  if (!cat) cat = await tx.expenseCategory.create({ data: { name: 'Salaries' } });
  const expense = await tx.expense.create({
    data: {
      date: run.payDate, categoryId: cat.id, amount: run.totalNet, paidVia, createdById: userId,
      notes: `Payroll ${run.runNo} (${toDateInput(run.periodStart)} to ${toDateInput(run.periodEnd)})`,
    },
  });
  const done = await tx.payrollRun.update({ where: { id: runId }, data: { status: 'PAID', paidAt: new Date(), expenseId: expense.id } });
  await audit(tx, userId, 'PAID', 'PayrollRun', runId, `Payroll ${run.runNo} paid — ₱${(run.totalNet / 100).toFixed(2)} recorded as Salaries expense`);
  return done;
}

/** Void a run. Finalized/paid runs give back cash-advance repayments and void the salary expense. */
export async function voidRun(tx: Tx, runId: number, userId: number, reason: string) {
  if (!reason.trim()) throw new Error('Enter a reason for voiding this payroll run.');
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { payslips: { include: { lines: true } } } });
  if (run.status === 'VOID') throw new Error('This payroll run is already void.');
  if (run.status === 'FINALIZED' || run.status === 'PAID') {
    for (const p of run.payslips) {
      for (const l of p.lines.filter((x) => x.cashAdvanceId)) {
        const a = await tx.cashAdvance.findUniqueOrThrow({ where: { id: l.cashAdvanceId! } });
        if (a.status === 'VOID') continue;
        await tx.cashAdvance.update({ where: { id: a.id }, data: { balance: Math.min(a.amount, a.balance + l.amount), status: 'OPEN' } });
      }
    }
  }
  if (run.expenseId) await tx.expense.update({ where: { id: run.expenseId }, data: { voided: true, voidReason: `Payroll ${run.runNo} voided: ${reason}` } });
  const done = await tx.payrollRun.update({ where: { id: runId }, data: { status: 'VOID', voidReason: reason } });
  await audit(tx, userId, 'VOID', 'PayrollRun', runId, `Voided payroll ${run.runNo}: ${reason}`);
  return done;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
