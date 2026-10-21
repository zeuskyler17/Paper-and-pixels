'use client';

import { Fragment, useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Field, Select, StatusBadge } from '@/components/ui';
import { peso } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { CASH_ADVANCE_STATUS, DEDUCTION_SCHEDULE, INCIDENT_SEVERITY, INCIDENT_TYPE, options } from '@/lib/labels';
import { deleteDeduction, toggleDeduction, updateDeduction, updateIncident, voidCashAdvance } from '../actions';
import { DEDUCTION_SUGGESTIONS } from '../_lib';

// ───────────────────────── Recurring deductions ─────────────────────────

export type DeductionRow = {
  id: number; name: string; amount: string; amountCentavos: number; schedule: string; active: boolean; notes: string; used: number;
};

export function DeductionFields({ d }: { d?: Pick<DeductionRow, 'name' | 'amount' | 'schedule' | 'notes'> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name *">
        <input name="name" list="deduction-suggestions" defaultValue={d?.name ?? ''} required placeholder="e.g. SSS" className="input" />
        <datalist id="deduction-suggestions">{DEDUCTION_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
      </Field>
      <Field label="Amount per deduction (₱) *">
        <input name="amount" inputMode="decimal" defaultValue={d?.amount ?? ''} required placeholder="0.00" className="input num" />
      </Field>
      <Field label="Schedule *"><Select name="schedule" options={options(DEDUCTION_SCHEDULE)} defaultValue={d?.schedule ?? 'EVERY_PAYROLL'} /></Field>
      <Field label="Notes"><input name="notes" defaultValue={d?.notes ?? ''} className="input" /></Field>
    </div>
  );
}

export function DeductionsTable({ rows }: { rows: DeductionRow[] }) {
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <table className="table">
      <thead><tr><th>Name</th><th className="text-right">Amount</th><th>Schedule</th><th>Status</th><th /></tr></thead>
      <tbody>
        {rows.map((d) => (
          <Fragment key={d.id}>
            <tr className={d.active ? '' : 'text-slate-400'}>
              <td>
                <div className="font-medium text-slate-800">{d.name}</div>
                {d.notes && <div className="text-xs text-slate-500">{d.notes}</div>}
              </td>
              <td className="text-right">{peso(d.amountCentavos)}</td>
              <td className="whitespace-nowrap">{d.schedule === 'ONCE_A_MONTH' ? 'Once a month' : 'Every payroll'}</td>
              <td>{d.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
              <td>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(editing === d.id ? null : d.id)}>
                    {editing === d.id ? 'Close' : 'Edit'}
                  </button>
                  <ActionForm action={toggleDeduction.bind(null, d.id)}>
                    <SubmitButton className="btn-secondary btn-sm">{d.active ? 'Deactivate' : 'Reactivate'}</SubmitButton>
                  </ActionForm>
                  {d.used === 0 && (
                    <ActionForm action={deleteDeduction.bind(null, d.id)} confirm={`Delete the "${d.name}" deduction? It was never used on a payslip.`}>
                      <SubmitButton className="btn-secondary btn-sm">Delete</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </td>
            </tr>
            {editing === d.id && (
              <tr>
                <td colSpan={5} className="bg-slate-50/70">
                  <ActionForm action={updateDeduction.bind(null, d.id)} className="space-y-3" onSuccess={() => setEditing(null)}>
                    <DeductionFields d={d} />
                    {d.used > 0 && <p className="text-xs text-slate-500">Used on {d.used} payslip line(s). Changes apply to future payroll runs only.</p>}
                    <SubmitButton>Save deduction</SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

// ───────────────────────── Cash advances ─────────────────────────

export type AdvanceRow = {
  id: number; date: string; amount: number; installment: number; balance: number; status: string;
  reason: string; voidReason: string; canVoid: boolean; repaidNote: string;
};

export function AdvancesTable({ rows }: { rows: AdvanceRow[] }) {
  const [voiding, setVoiding] = useState<number | null>(null);
  return (
    <table className="table">
      <thead>
        <tr><th>Date</th><th className="text-right">Amount</th><th className="text-right">Per payroll</th><th className="text-right">Balance</th><th>Status</th><th>Reason</th><th /></tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <Fragment key={a.id}>
            <tr className={a.status === 'VOID' ? 'text-slate-400' : ''}>
              <td className="whitespace-nowrap">{fmtDate(a.date)}</td>
              <td className={`text-right ${a.status === 'VOID' ? 'line-through' : ''}`}>{peso(a.amount)}</td>
              <td className="text-right">{peso(a.installment)}</td>
              <td className={`text-right font-semibold ${a.status === 'OPEN' ? 'text-slate-900' : ''}`}>{a.status === 'VOID' ? '—' : peso(a.balance)}</td>
              <td><StatusBadge value={a.status} labels={CASH_ADVANCE_STATUS} /></td>
              <td className="min-w-[10rem]">
                {a.reason || '—'}
                {a.voidReason && <div className="text-xs text-red-700">Void: {a.voidReason}</div>}
              </td>
              <td>
                {a.status === 'OPEN' && (
                  <div className="flex justify-end">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setVoiding(voiding === a.id ? null : a.id)}>
                      {voiding === a.id ? 'Close' : 'Void'}
                    </button>
                  </div>
                )}
              </td>
            </tr>
            {voiding === a.id && (
              <tr>
                <td colSpan={7} className="bg-slate-50/70">
                  {a.canVoid ? (
                    <ActionForm action={voidCashAdvance.bind(null, a.id)} className="flex flex-wrap items-end gap-2" confirm="Void this cash advance?">
                      <Field label="Reason for voiding *" className="min-w-[14rem] flex-1">
                        <input name="reason" required className="input" placeholder="e.g. Entered by mistake" />
                      </Field>
                      <SubmitButton className="btn-danger">Void cash advance</SubmitButton>
                    </ActionForm>
                  ) : (
                    <p className="text-[13px] text-slate-600">
                      This cash advance can&apos;t be voided: {a.repaidNote} The remaining balance will keep being deducted from payroll
                      until it is fully paid. If a payroll run is still a draft, void or recalculate that run first.
                    </p>
                  )}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

// ───────────────────────── Incidents ─────────────────────────

export type IncidentRow = {
  id: number; date: string; type: string; severity: string; title: string; description: string; actionTaken: string;
  loggedBy: string; createdAt: string; edited: boolean;
};

export function IncidentFields({ i }: { i?: Pick<IncidentRow, 'date' | 'type' | 'severity' | 'title' | 'description' | 'actionTaken'> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Date *"><input name="date" type="date" defaultValue={i?.date} required className="input" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type *"><Select name="type" options={options(INCIDENT_TYPE)} defaultValue={i?.type ?? 'INCIDENT'} /></Field>
        <Field label="Severity *"><Select name="severity" options={options(INCIDENT_SEVERITY)} defaultValue={i?.severity ?? 'MINOR'} /></Field>
      </div>
      <Field label="Title *" className="sm:col-span-2"><input name="title" defaultValue={i?.title} required placeholder="Short summary" className="input" /></Field>
      <Field label="Description *" className="sm:col-span-2"><textarea name="description" defaultValue={i?.description} required rows={3} className="input" /></Field>
      <Field label="Action taken" className="sm:col-span-2"><textarea name="actionTaken" defaultValue={i?.actionTaken} rows={2} placeholder="e.g. Verbal warning, written memo" className="input" /></Field>
    </div>
  );
}

export function IncidentList({ rows }: { rows: IncidentRow[] }) {
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((i) => (
        <li key={i.id} className="py-3 first:pt-0 last:pb-0">
          {editing === i.id ? (
            <ActionForm action={updateIncident.bind(null, i.id)} className="space-y-3" onSuccess={() => setEditing(null)}>
              <IncidentFields i={i} />
              <div className="flex flex-wrap gap-2">
                <SubmitButton>Save changes</SubmitButton>
                <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </ActionForm>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-[12.5px] text-slate-500">{fmtDate(i.date)}</span>
                  <StatusBadge value={i.type} labels={INCIDENT_TYPE} />
                  <StatusBadge value={i.severity} labels={INCIDENT_SEVERITY} />
                </div>
                <div className="font-semibold text-slate-900">{i.title}</div>
                <p className="whitespace-pre-line text-[13px] text-slate-700">{i.description}</p>
                {i.actionTaken && (
                  <p className="whitespace-pre-line text-[13px] text-slate-700">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Action taken: </span>{i.actionTaken}
                  </p>
                )}
                <div className="text-xs text-slate-500">Logged by {i.loggedBy} · {i.createdAt}{i.edited && ' · edited'}</div>
              </div>
              <button type="button" className="btn-secondary btn-sm shrink-0 self-start" onClick={() => setEditing(i.id)}>Edit</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
