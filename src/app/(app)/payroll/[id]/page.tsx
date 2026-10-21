import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, fmtDateTime, toDateInput } from '@/lib/dates';
import { PAYMENT_METHOD, PAYROLL_STATUS, PAY_FREQUENCY, PAY_TYPE, options } from '@/lib/labels';
import { eligibleEmployees } from '@/lib/payroll';
import { employeeName } from '@/lib/hr';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Empty, PageHeader, Select, Stat, StatusBadge, TableWrap } from '@/components/ui';
import { addEmployeeToRun, finalizeRunAction, markPaidAction, recalcRun, removePayslip, voidRunAction } from '../actions';
import { fmtHours, fmtNum, rateLabel, sum } from '../_lib';

export const metadata = { title: 'Payroll run' };

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('hr');
  const { id } = await params;
  const run = await prisma.payrollRun.findUnique({
    where: { id: Number(id) || 0 },
    include: {
      payslips: {
        include: { employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true, nickname: true, position: true } } },
        orderBy: [{ employee: { lastName: 'asc' } }, { employee: { firstName: 'asc' } }],
      },
    },
  });
  if (!run) notFound();

  const draft = run.status === 'DRAFT';
  const from = toDateInput(run.periodStart), to = toDateInput(run.periodEnd);
  const endEx = new Date(run.periodEnd.getTime() + 86_400_000);
  const empIds = run.payslips.map((p) => p.employeeId);

  const [entries, eligible, users] = await Promise.all([
    empIds.length && run.status !== 'VOID'
      ? prisma.timeEntry.findMany({
          where: { employeeId: { in: empIds }, workDate: { gte: run.periodStart, lt: endEx } },
          select: { employeeId: true, dayType: true, timeIn: true, timeOut: true, overtimeMinutes: true, otApproved: true },
        })
      : Promise.resolve([]),
    draft ? eligibleEmployees(prisma, run) : Promise.resolve([]),
    prisma.user.findMany({ where: { id: { in: [run.createdById, run.finalizedById ?? 0] } }, select: { id: true, name: true } }),
  ]);
  const userName = (uid: number | null) => users.find((u) => u.id === uid)?.name ?? '—';
  const addable = eligible.filter((e) => !empIds.includes(e.id));

  // Cheap warnings recomputed on every render (nothing stored).
  const warnings = run.payslips
    .map((p) => {
      const mine = entries.filter((e) => e.employeeId === p.employeeId);
      const incomplete = mine.filter((e) => e.dayType !== 'PAID_LEAVE' && (!e.timeIn || !e.timeOut)).length;
      const unapprovedOt = mine.filter((e) => e.overtimeMinutes >= 30 && !e.otApproved).length;
      return { p, incomplete, unapprovedOt };
    })
    .filter((w) => w.incomplete || w.unapprovedOt);

  const tot = {
    days: sum(run.payslips, (p) => p.daysWorked),
    reg: sum(run.payslips, (p) => p.regularHours),
    ot: sum(run.payslips, (p) => p.overtimeHours),
    tardy: sum(run.payslips, (p) => p.lateMinutes + p.undertimeMinutes),
    abs: sum(run.payslips, (p) => p.absentDays),
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Payroll ${run.runNo}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge value={run.status} labels={PAYROLL_STATUS} />
            <span>{fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}</span>
            <span>· pay date {fmtDate(run.payDate)}</span>
            <span>· {PAY_FREQUENCY[run.frequency]}</span>
          </span>
        }
        actions={
          <>
            <Link href="/payroll" className="btn-secondary">← Payroll</Link>
            <Link href={`/print/payroll/${run.id}`} className="btn-secondary">Print register</Link>
            <Link href={`/print/payroll/${run.id}/payslips`} className="btn-secondary">Print all payslips</Link>
          </>
        }
      />

      {run.status === 'VOID' && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">This payroll run is void — {run.voidReason}. It is read-only and not counted anywhere.</p>
      )}
      {run.status === 'PAID' && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Paid on {fmtDateTime(run.paidAt)} · recorded as a Salaries expense (<Link href="/expenses" className="link">view expenses</Link>).
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Gross pay" value={peso(run.totalGross)} />
        <Stat label="Deductions" value={peso(run.totalDeductions)} />
        <Stat label="Net pay" value={peso(run.totalNet)} tone={run.status === 'PAID' ? 'green' : undefined} />
        <Stat label="Employees" value={run.payslips.length} hint={`Created by ${userName(run.createdById)}${run.finalizedAt ? ` · finalized ${fmtDate(run.finalizedAt)} by ${userName(run.finalizedById)}` : ''}`} />
      </div>

      {warnings.length > 0 && (
        <Card title="Check before finalizing">
          <p className="mb-2 text-[13px] text-slate-600">
            These time records affect pay. Incomplete days (missing time in/out) are not paid; overtime is only paid once approved.
            {draft && ' Fix them in Timekeeping, then click “Recalculate from time records”.'}
          </p>
          <ul className="divide-y divide-slate-100 text-[13px]">
            {warnings.map(({ p, incomplete, unapprovedOt }) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{employeeName(p.employee)}</span>
                  <span className="text-red-700">
                    {incomplete > 0 && ` · ${incomplete} incomplete time record(s)`}
                    {unapprovedOt > 0 && ` · ${unapprovedOt} day(s) with unapproved overtime`}
                  </span>
                </span>
                <Link href={`/timekeeping?employee=${p.employeeId}&from=${from}&to=${to}`} className="link text-xs">Open time records →</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Payroll register">
        {run.payslips.length === 0 ? (
          <Empty>No payslips in this run.{draft && ' Add an employee below or recalculate from time records.'}</Empty>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th><th>Pay type &amp; rate</th>
                  <th className="text-right">Days</th><th className="text-right">Reg. hrs</th><th className="text-right">OT hrs</th>
                  <th className="text-right">Late/UT min</th><th className="text-right">Absences</th>
                  <th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net</th>
                  {draft && <th />}
                </tr>
              </thead>
              <tbody>
                {run.payslips.map((p) => (
                  <tr key={p.id}>
                    <td className="min-w-[10rem]">
                      <Link href={`/payroll/${run.id}/payslips/${p.id}`} className="link">{employeeName(p.employee)}</Link>
                      <div className="num text-xs text-slate-500">{p.employee.employeeNo}</div>
                    </td>
                    <td className="whitespace-nowrap">
                      <div>{PAY_TYPE[p.payType]}</div>
                      <div className="num text-xs text-slate-500">{rateLabel(p.payType, p.rate)}</div>
                    </td>
                    <td className="text-right">{fmtNum(p.daysWorked)}</td>
                    <td className="text-right">{fmtHours(p.regularHours)}</td>
                    <td className="text-right">{fmtHours(p.overtimeHours)}</td>
                    <td className="text-right">{fmtNum(p.lateMinutes + p.undertimeMinutes)}</td>
                    <td className="text-right">{fmtNum(p.absentDays)}</td>
                    <td className="text-right whitespace-nowrap">{peso(p.gross)}</td>
                    <td className="text-right whitespace-nowrap">{peso(p.deductions)}</td>
                    <td className={`text-right whitespace-nowrap font-semibold ${p.net < 0 ? 'text-red-600' : ''}`}>{peso(p.net)}</td>
                    {draft && (
                      <td className="text-right">
                        <ActionForm action={removePayslip.bind(null, p.id)} confirm={`Remove ${employeeName(p.employee)} from this draft payroll?`}>
                          <SubmitButton className="text-xs font-medium text-red-700 hover:underline">Remove</SubmitButton>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={2}>Totals ({run.payslips.length})</td>
                  <td className="text-right">{fmtNum(tot.days)}</td>
                  <td className="text-right">{fmtHours(tot.reg)}</td>
                  <td className="text-right">{fmtHours(tot.ot)}</td>
                  <td className="text-right">{fmtNum(tot.tardy)}</td>
                  <td className="text-right">{fmtNum(tot.abs)}</td>
                  <td className="text-right whitespace-nowrap">{peso(run.totalGross)}</td>
                  <td className="text-right whitespace-nowrap">{peso(run.totalDeductions)}</td>
                  <td className="text-right whitespace-nowrap">{peso(run.totalNet)}</td>
                  {draft && <td />}
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      {draft && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Draft actions">
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[13px] text-slate-600">
                  Rebuild every payslip from the current time records, holidays, recurring deductions and cash advances. Manual lines you added are kept.
                </p>
                <ActionForm action={recalcRun.bind(null, run.id)}>
                  <SubmitButton className="btn-secondary">Recalculate from time records</SubmitButton>
                </ActionForm>
              </div>
              <div className="border-t border-slate-100 pt-4">
                <p className="mb-2 text-[13px] text-slate-600">
                  Finalizing locks the payslips and applies cash-advance repayments. Employees can then see their payslips.
                </p>
                <ActionForm action={finalizeRunAction.bind(null, run.id)} confirm={`Finalize payroll ${run.runNo} (net ${peso(run.totalNet)})? Payslips can no longer be edited.`}>
                  <SubmitButton>Finalize payroll</SubmitButton>
                </ActionForm>
              </div>
            </div>
          </Card>
          <Card title="Add employee">
            {addable.length === 0 ? (
              <Empty>Every eligible {run.frequency === 'WEEKLY' ? 'weekly' : 'semi-monthly'} employee is already in this run.</Empty>
            ) : (
              <ActionForm action={addEmployeeToRun.bind(null, run.id)} resetOnSuccess className="space-y-3">
                <Select
                  name="employeeId" required placeholder="Choose employee…"
                  options={addable.map((e) => ({ value: e.id, label: `${employeeName(e)} · ${e.employeeNo}` }))}
                />
                <p className="text-xs text-slate-500">Only employees on {run.frequency === 'WEEKLY' ? 'weekly' : 'semi-monthly'} pay who were employed during the period are listed.</p>
                <SubmitButton className="btn-secondary">Add to payroll</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
      )}

      {run.status === 'FINALIZED' && (
        <Card title="Pay out">
          <ActionForm action={markPaidAction.bind(null, run.id)} confirm={`Mark payroll ${run.runNo} as paid (${peso(run.totalNet)})? A Salaries expense will be recorded.`} className="flex flex-wrap items-end gap-2">
            <label className="block w-56">
              <span className="label">Paid via</span>
              <Select name="paidVia" options={options(PAYMENT_METHOD)} defaultValue="CASH" required />
            </label>
            <SubmitButton>Mark as paid</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">Records one expense of {peso(run.totalNet)} in the “Salaries” category dated {fmtDate(run.payDate)}.</p>
        </Card>
      )}

      {run.status !== 'VOID' && (
        <details className="card px-4 py-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-red-700">Void this payroll run</summary>
          <p className="mt-2 text-[13px] text-slate-600">
            {run.status === 'DRAFT' && 'The draft is kept for the record but no longer counts.'}
            {run.status === 'FINALIZED' && 'Cash-advance repayments from this run are given back to the open balances.'}
            {run.status === 'PAID' && 'Cash-advance repayments are given back and the Salaries expense is voided too.'}
          </p>
          <ActionForm action={voidRunAction.bind(null, run.id)} confirm={`Void payroll ${run.runNo}? This cannot be undone.`} className="mt-2 flex flex-wrap items-end gap-2">
            <input name="reason" className="input w-72 max-w-full" placeholder="Reason *" required />
            <SubmitButton className="btn-danger">Void payroll</SubmitButton>
          </ActionForm>
        </details>
      )}

      {run.notes && <Card title="Notes"><p className="whitespace-pre-line text-[13px]">{run.notes}</p></Card>}
    </div>
  );
}
