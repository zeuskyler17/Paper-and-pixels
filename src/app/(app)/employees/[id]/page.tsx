import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { centavosToInput, peso } from '@/lib/money';
import { addDays, fmtDate, fmtDateTime, manilaRange, startOfMonthManila, toDateInput, todayManila } from '@/lib/dates';
import { employeeName } from '@/lib/hr';
import { suggestUsername } from '@/lib/logins';
import { fmtClock, fmtMinutes } from '@/lib/timekeeping';
import { EMPLOYMENT_STATUS, PAY_FREQUENCY, PAYROLL_STATUS } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Empty, Field, PageHeader, Stat, StatusBadge, TableWrap } from '@/components/ui';
import { addCashAdvance, addDeduction, addIncident, createLoginForEmployee, setPin, unlockPin, updateEmployee } from '../actions';
import { LoginFields } from '../LoginFields';
import { roleOptions } from '../../users/_tabs';
import { EmployeeFields } from '../EmployeeFields';
import { linkableUsers, toFormValues } from '../_data';
import { monthlyEstimate, rateLabel, scheduleLabel } from '../_lib';
import {
  AdvancesTable, DeductionFields, DeductionsTable, IncidentFields, IncidentList,
  type AdvanceRow, type DeductionRow, type IncidentRow,
} from './Sections';

export const metadata = { title: 'Employee' };

const TABS: [string, string][] = [
  ['profile', 'Profile'], ['pin', 'PIN'], ['deductions', 'Deductions'], ['cash-advances', 'Cash advances'],
  ['incidents', 'Incidents'], ['payslips', 'Payslips'],
];

function LockIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function endOfMonth(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser('hr');
  const { id } = await params;
  const employee = await prisma.employee.findUnique({
    where: { id: Number(id) || 0 },
    include: { user: { select: { username: true, name: true, role: true, active: true } } },
  });
  if (!employee) notFound();
  const empId = employee.id;

  const today = todayManila();
  const monthStart = startOfMonthManila();
  const monthEnd = endOfMonth(monthStart);
  const month = manilaRange(monthStart, today);

  const [entries, deductions, advances, incidents, payslips, lastClosedRun, users, roles] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { employeeId: empId, workDate: { gte: month.start, lt: month.end } },
      select: { timeIn: true, dayType: true, lateMinutes: true, overtimeMinutes: true, otApproved: true },
    }),
    prisma.recurringDeduction.findMany({
      where: { employeeId: empId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { lines: true } } },
    }),
    prisma.cashAdvance.findMany({
      where: { employeeId: empId },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: {
        lines: {
          where: { payslip: { run: { status: { not: 'VOID' } } } },
          select: { payslip: { select: { run: { select: { runNo: true, status: true } } } } },
        },
      },
    }),
    prisma.incident.findMany({
      where: { employeeId: empId },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.payslip.findMany({
      where: { employeeId: empId },
      include: { run: { select: { id: true, runNo: true, periodStart: true, periodEnd: true, payDate: true, status: true } } },
      orderBy: { run: { periodEnd: 'desc' } },
    }),
    prisma.payrollRun.findFirst({
      where: { frequency: employee.payFrequency, status: { in: ['FINALIZED', 'PAID'] } },
      orderBy: { periodEnd: 'desc' },
      select: { periodEnd: true },
    }),
    linkableUsers(empId),
    me.isAdmin ? roleOptions() : Promise.resolve([]),
  ]);

  // This month's attendance
  const daysPresent = entries.filter((e) => e.timeIn).length;
  const lateMin = entries.reduce((s, e) => s + e.lateMinutes, 0);
  const otMin = entries.filter((e) => e.otApproved).reduce((s, e) => s + e.overtimeMinutes, 0);
  const paidLeave = entries.filter((e) => e.dayType === 'PAID_LEAVE').length;

  const recomputeFrom = lastClosedRun ? addDays(toDateInput(lastClosedRun.periodEnd), 1) : addDays(today, -31);

  const deductionRows: DeductionRow[] = deductions.map((d) => ({
    id: d.id, name: d.name, amount: centavosToInput(d.amount), amountCentavos: d.amount, schedule: d.schedule,
    active: d.active, notes: d.notes ?? '', used: d._count.lines,
  }));
  const activeDeductions = deductions.filter((d) => d.active).reduce((s, d) => s + d.amount, 0);

  const advanceRows: AdvanceRow[] = advances.map((a) => {
    const runs = [...new Set(a.lines.map((l) => l.payslip.run.runNo))];
    const repaid = a.amount - a.balance;
    const repaidNote = runs.length
      ? `it is already on payroll ${runs.join(', ')}${repaid > 0 ? ` (${peso(repaid)} repaid)` : ''}.`
      : `${peso(repaid)} was already repaid.`;
    return {
      id: a.id, date: a.date.toISOString(), amount: a.amount, installment: a.installment, balance: a.balance, status: a.status,
      reason: a.reason ?? '', voidReason: a.voidReason ?? '', canVoid: a.balance === a.amount && runs.length === 0, repaidNote,
    };
  });
  const openBalance = advances.filter((a) => a.status === 'OPEN').reduce((s, a) => s + a.balance, 0);

  const incidentRows: IncidentRow[] = incidents.map((i) => ({
    id: i.id, date: toDateInput(i.date), type: i.type, severity: i.severity, title: i.title, description: i.description,
    actionTaken: i.actionTaken ?? '', loggedBy: i.createdBy.name, createdAt: fmtDateTime(i.createdAt),
    edited: i.updatedAt.getTime() - i.createdAt.getTime() > 1000,
  }));

  const pinLocked = !!employee.pinLockedUntil && employee.pinLockedUntil > new Date();
  const name = employeeName(employee);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${name}${employee.nickname ? ` “${employee.nickname}”` : ''}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="num">{employee.employeeNo}</span> · {employee.position} · <StatusBadge value={employee.status} labels={EMPLOYMENT_STATUS} />
            {employee.endDate && <span>· until {fmtDate(employee.endDate)}</span>}
          </span>
        }
        actions={<>
          <Link href={`/timekeeping?employee=${empId}`} className="btn-secondary">Time records</Link>
          <Link href={`/print/dtr?employee=${empId}&from=${monthStart}&to=${monthEnd}`} className="btn-secondary">Print DTR</Link>
          <Link href="/employees" className="btn-secondary">Back</Link>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Days present (this month)" value={daysPresent} hint={paidLeave ? `+ ${paidLeave} paid leave` : `Since ${fmtDate(monthStart)}`} />
        <Stat label="Late (this month)" value={lateMin ? fmtMinutes(lateMin) : '0m'} tone={lateMin > 0 ? 'amber' : undefined} />
        <Stat label="Approved OT (this month)" value={otMin ? fmtMinutes(otMin) : '0h'} />
        <Stat label="Pay" value={<span className="text-[18px]">{rateLabel(employee)}</span>}
          hint={`${PAY_FREQUENCY[employee.payFrequency]} · ≈ ${peso(monthlyEstimate(employee))}/mo`} />
      </div>

      <nav className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto rounded border border-slate-200 bg-white/95 p-1 backdrop-blur">
        {TABS.map(([anchor, label]) => (
          <a key={anchor} href={`#${anchor}`} className="whitespace-nowrap rounded px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-600 hover:bg-slate-100 hover:text-slate-900">
            {label}
          </a>
        ))}
      </nav>

      <div id="profile" className="scroll-mt-16">
        <Card title="Profile" actions={<span className="num text-xs text-slate-500">{scheduleLabel(employee)}</span>}>
          <ActionForm action={updateEmployee.bind(null, empId)} className="space-y-4">
            <EmployeeFields e={toFormValues(employee)} users={users} recomputeFrom={recomputeFrom} />
            <SubmitButton>Save profile</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <div id="pin" className="scroll-mt-16">
        {me.isAdmin && !employee.userId && (
          <Card title="Login" actions={<span className="text-xs font-semibold text-amber-700">No login yet</span>}>
            <p className="mb-3 text-[12.5px] text-slate-600">This employee has no login. Create one so they can time in, see their own time records and payslips, and (for production) their jobs.</p>
            <ActionForm action={createLoginForEmployee.bind(null, employee.id)} className="space-y-3">
              <LoginFields roles={roles} suggestedUsername={suggestUsername(employee.firstName, employee.lastName)} />
              <SubmitButton>Create login</SubmitButton>
            </ActionForm>
          </Card>
        )}
        <Card title="Time-clock PIN">
          <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
            <div className="space-y-2 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Status:</span>
                {employee.pinHash ? <span className="font-semibold text-emerald-700">PIN is set</span> : <span className="font-semibold text-amber-700">PIN is not set</span>}
              </div>
              {pinLocked ? (
                <div className="space-y-2">
                  <p className="font-medium text-red-700">Locked after too many wrong tries until {fmtClock(employee.pinLockedUntil)}.</p>
                  <ActionForm action={unlockPin.bind(null, empId)}>
                    <SubmitButton className="btn-secondary btn-sm">Unlock now</SubmitButton>
                  </ActionForm>
                </div>
              ) : employee.pinFailedCount > 0 ? (
                <p className="text-amber-700">{employee.pinFailedCount} wrong attempt(s) since last success.</p>
              ) : employee.pinHash ? <p className="text-slate-500">Not locked.</p> : null}
              <p className="text-xs text-slate-500">The employee picks their name on the time clock and enters this PIN. PINs are stored encrypted and can&apos;t be viewed — only reset.</p>
            </div>
            <ActionForm action={setPin.bind(null, empId)} resetOnSuccess className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={employee.pinHash ? 'New PIN *' : 'PIN *'} hint="4–6 digits">
                  <input name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" minLength={4} maxLength={6} autoComplete="new-password" required className="input num" />
                </Field>
                <Field label="Repeat PIN *">
                  <input name="pinConfirm" type="password" inputMode="numeric" pattern="\d{4,6}" minLength={4} maxLength={6} autoComplete="new-password" required className="input num" />
                </Field>
              </div>
              <SubmitButton>{employee.pinHash ? 'Reset PIN' : 'Set PIN'}</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      </div>

      <div id="deductions" className="scroll-mt-16">
        <Card title="Recurring deductions" actions={<span className="text-xs text-slate-500">Active total <span className="num font-semibold text-slate-800">{peso(activeDeductions)}</span></span>}>
          <div className="space-y-4">
            {deductionRows.length === 0 ? <Empty>No recurring deductions yet (e.g. SSS).</Empty> : (
              <TableWrap><DeductionsTable rows={deductionRows} /></TableWrap>
            )}
            <details className="rounded border border-slate-200 bg-slate-50/60 p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-brand-700">+ Add deduction</summary>
              <ActionForm action={addDeduction.bind(null, empId)} resetOnSuccess className="mt-3 space-y-3">
                <DeductionFields />
                <SubmitButton>Add deduction</SubmitButton>
              </ActionForm>
            </details>
          </div>
        </Card>
      </div>

      <div id="cash-advances" className="scroll-mt-16">
        <Card title="Cash advances (bale)" actions={<span className="text-xs text-slate-500">Open balance <span className={`num font-semibold ${openBalance > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{peso(openBalance)}</span></span>}>
          <div className="space-y-4">
            {advanceRows.length === 0 ? <Empty>No cash advances.</Empty> : (
              <TableWrap><AdvancesTable rows={advanceRows} /></TableWrap>
            )}
            <details className="rounded border border-slate-200 bg-slate-50/60 p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-brand-700">+ Add cash advance</summary>
              <ActionForm action={addCashAdvance.bind(null, empId)} resetOnSuccess className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date *"><input name="date" type="date" defaultValue={today} required className="input" /></Field>
                  <Field label="Amount (₱) *"><input name="amount" inputMode="decimal" required placeholder="0.00" className="input num" /></Field>
                  <Field label="Deduct per payroll (₱)" hint="Leave blank to deduct the full amount on the next payroll.">
                    <input name="installment" inputMode="decimal" placeholder="Same as amount" className="input num" />
                  </Field>
                  <Field label="Reason"><input name="reason" className="input" /></Field>
                </div>
                <SubmitButton>Record cash advance</SubmitButton>
              </ActionForm>
            </details>
          </div>
        </Card>
      </div>

      <div id="incidents" className="scroll-mt-16">
        <Card title="Incidents & violations" actions={<span className="flex items-center gap-1 text-xs text-slate-500"><LockIcon />Admins only</span>}>
          <div className="space-y-4">
            <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <LockIcon className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />Visible to admins only. Employees can&apos;t see this. Records can be edited (changes are logged) but not deleted.
            </p>
            {incidentRows.length === 0 ? <Empty>No incidents or violations recorded.</Empty> : <IncidentList rows={incidentRows} />}
            <details className="rounded border border-slate-200 bg-slate-50/60 p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-brand-700">+ Add record</summary>
              <ActionForm action={addIncident.bind(null, empId)} resetOnSuccess className="mt-3 space-y-3">
                <IncidentFields i={{ date: today, type: 'INCIDENT', severity: 'MINOR', title: '', description: '', actionTaken: '' }} />
                <SubmitButton>Add record</SubmitButton>
              </ActionForm>
            </details>
          </div>
        </Card>
      </div>

      <div id="payslips" className="scroll-mt-16">
        <Card title="Payslips">
          {payslips.length === 0 ? <Empty>No payslips yet.</Empty> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Run no.</th><th>Period</th><th>Pay date</th><th>Status</th><th className="text-right">Gross</th><th className="text-right">Net</th></tr></thead>
                <tbody>
                  {payslips.map((p) => (
                    <tr key={p.id} className={p.run.status === 'VOID' ? 'text-slate-400' : ''}>
                      <td className="whitespace-nowrap"><Link href={`/payroll/${p.run.id}/payslips/${p.id}`} className="link num">{p.run.runNo}</Link></td>
                      <td className="whitespace-nowrap">{fmtDate(p.run.periodStart)} – {fmtDate(p.run.periodEnd)}</td>
                      <td className="whitespace-nowrap">{fmtDate(p.run.payDate)}</td>
                      <td><StatusBadge value={p.run.status} labels={PAYROLL_STATUS} /></td>
                      <td className="text-right">{peso(p.gross)}</td>
                      <td className={`text-right font-semibold ${p.run.status === 'VOID' ? 'line-through' : ''}`}>{peso(p.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </div>
  );
}
