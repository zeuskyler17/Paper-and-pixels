import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PayslipLine } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, toDateInput } from '@/lib/dates';
import { fmtMinutes } from '@/lib/timekeeping';
import { PAYROLL_STATUS, PAY_TYPE } from '@/lib/labels';
import { employeeName } from '@/lib/hr';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, DL, Empty, PageHeader, StatusBadge } from '@/components/ui';
import { addManualLine, recalcPayslipAction, removeManualLine, updatePayslipNotes } from '../../../actions';
import { fmtHours, fmtNum, groupLines, rateLabel, sum } from '../../../_lib';

export const metadata = { title: 'Payslip' };

export default async function PayslipPage({ params }: { params: Promise<{ id: string; payslipId: string }> }) {
  await requireUser('hr');
  const { id, payslipId } = await params;
  const p = await prisma.payslip.findUnique({
    where: { id: Number(payslipId) || 0 },
    include: { run: true, employee: true, lines: { orderBy: { id: 'asc' } } },
  });
  if (!p || p.runId !== Number(id)) notFound();
  const draft = p.run.status === 'DRAFT';
  const g = groupLines(p.lines);
  const earnings = sum(g.earnings, (l) => l.amount);
  const attendance = sum(g.attendance, (l) => l.amount);
  const from = toDateInput(p.run.periodStart), to = toDateInput(p.run.periodEnd);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Payslip — ${employeeName(p.employee)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/payroll/${p.runId}`} className="link num">{p.run.runNo}</Link>
            <StatusBadge value={p.run.status} labels={PAYROLL_STATUS} />
            <span>{fmtDate(p.run.periodStart)} – {fmtDate(p.run.periodEnd)} · pay date {fmtDate(p.run.payDate)}</span>
          </span>
        }
        actions={
          <>
            <Link href={`/payroll/${p.runId}`} className="btn-secondary">← Payroll run</Link>
            <Link href={`/print/payslip/${p.id}`} className="btn-secondary">Print payslip</Link>
          </>
        }
      />

      {p.run.status === 'VOID' && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">This payroll run is void — {p.run.voidReason}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Employee" className="lg:col-span-2">
          <DL items={[
            ['Employee', <span key="e">{employeeName(p.employee)} · <span className="num">{p.employee.employeeNo}</span></span>],
            ['Position', p.employee.position],
            ['Pay type', PAY_TYPE[p.payType]],
            ['Rate', <span key="r" className="num">{rateLabel(p.payType, p.rate)}</span>],
            ['Daily rate', <span key="d" className="num">{peso(p.dailyRate)}</span>],
            ['Period', `${fmtDate(p.run.periodStart)} – ${fmtDate(p.run.periodEnd)}`],
          ]} />
          <div className="mt-3">
            <Link href={`/timekeeping?employee=${p.employeeId}&from=${from}&to=${to}`} className="link text-xs">Time records for this period →</Link>
          </div>
        </Card>
        <Card title="Attendance">
          <dl className="space-y-1.5 text-[13px]">
            <Row k="Days worked" v={fmtNum(p.daysWorked)} />
            <Row k="Regular hours" v={fmtHours(p.regularHours)} />
            <Row k="Overtime hours" v={fmtHours(p.overtimeHours)} />
            <Row k="Late" v={fmtMinutes(p.lateMinutes)} />
            <Row k="Undertime" v={fmtMinutes(p.undertimeMinutes)} />
            <Row k="Absences (days)" v={fmtNum(p.absentDays)} />
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <LineCard title="Earnings" lines={g.earnings} total={earnings} draft={draft} empty="No earnings." />
          <LineCard title="Attendance deductions" lines={g.attendance} total={attendance} draft={draft} empty="No absences or late/undertime deductions." negative />
          <LineCard title="Deductions" lines={g.deductions} total={p.deductions} draft={draft} empty="No deductions." negative />
        </div>
        <div className="space-y-4">
          <Card title="Summary">
            <dl className="space-y-1.5 text-[13px]">
              <Row k="Total earnings" v={peso(earnings)} />
              <Row k="Less attendance deductions" v={`−${peso(attendance)}`} />
              <Row k="Gross pay" v={peso(p.gross)} bold />
              <Row k="Less deductions" v={`−${peso(p.deductions)}`} />
            </dl>
            <div className="mt-3 border-t-2 border-slate-800 pt-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-slate-500">Net pay</div>
              <div className={`num mt-1 text-[30px] font-semibold leading-none ${p.net < 0 ? 'text-red-600' : 'text-slate-900'}`}>{peso(p.net)}</div>
            </div>
          </Card>

          {draft ? (
            <>
              <Card title="Add earning / deduction">
                <ActionForm action={addManualLine.bind(null, p.id)} resetOnSuccess className="space-y-3">
                  <label className="block">
                    <span className="label">Type</span>
                    <select name="kind" className="input" defaultValue="EARNING">
                      <option value="EARNING">Earning (adds to pay)</option>
                      <option value="DEDUCTION">Deduction (subtracts from pay)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="label">Description</span>
                    <input name="label" className="input" placeholder="e.g. Allowance, Bonus, Uniform" required list="manual-labels" />
                    <datalist id="manual-labels">
                      <option value="Allowance" /><option value="Bonus" /><option value="Incentive" /><option value="Adjustment" /><option value="Uniform" /><option value="Shortage" />
                    </datalist>
                  </label>
                  <label className="block">
                    <span className="label">Amount (₱)</span>
                    <input name="amount" className="input" inputMode="decimal" placeholder="0.00" required />
                  </label>
                  <SubmitButton className="btn-secondary">Add line</SubmitButton>
                </ActionForm>
              </Card>
              <Card title="Recalculate">
                <p className="mb-2 text-[13px] text-slate-600">
                  Automatic lines come from the time records and can’t be edited here. Fix the time records, then recalculate. Manual lines are kept.
                </p>
                <ActionForm action={recalcPayslipAction.bind(null, p.id)}>
                  <SubmitButton className="btn-secondary">Recalculate this payslip</SubmitButton>
                </ActionForm>
              </Card>
              <Card title="Notes">
                <ActionForm action={updatePayslipNotes.bind(null, p.id)} className="space-y-2">
                  <textarea name="notes" rows={3} className="input" defaultValue={p.notes ?? ''} placeholder="Shown on the printed payslip" />
                  <SubmitButton className="btn-secondary">Save notes</SubmitButton>
                </ActionForm>
              </Card>
            </>
          ) : (
            p.notes && <Card title="Notes"><p className="whitespace-pre-line text-[13px]">{p.notes}</p></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function LineCard({ title, lines, total, draft, empty, negative }: { title: string; lines: PayslipLine[]; total: number; draft: boolean; empty: string; negative?: boolean }) {
  return (
    <Card title={title}>
      {lines.length === 0 ? <Empty>{empty}</Empty> : (
        <table className="table">
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.label}
                  {l.manual && <span className="ml-2 rounded-[3px] bg-slate-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">manual</span>}
                  {l.quantity != null && !l.manual && <span className="ml-2 text-xs text-slate-400">× {fmtNum(l.quantity)}</span>}
                </td>
                <td className="text-right whitespace-nowrap">{negative ? '−' : ''}{peso(l.amount)}</td>
                {draft && (
                  <td className="w-16 text-right">
                    {l.manual && (
                      <ActionForm action={removeManualLine.bind(null, l.id)} confirm={`Remove “${l.label}”?`}>
                        <SubmitButton className="text-xs font-medium text-red-700 hover:underline">Remove</SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td>Total</td>
              <td className="text-right whitespace-nowrap">{negative ? '−' : ''}{peso(total)}</td>
              {draft && <td />}
            </tr>
          </tfoot>
        </table>
      )}
    </Card>
  );
}

function Row({ k, v, bold }: { k: string; v: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? 'font-semibold' : ''}`}>
      <dt className="text-slate-600">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}
