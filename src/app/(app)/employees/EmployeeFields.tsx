'use client';

import { LoginFields, type RoleChoice } from './LoginFields';

import { useState } from 'react';
import { Field, Select } from '@/components/ui';
import { EMPLOYMENT_STATUS, PAY_FREQUENCY, PAY_TYPE, WEEKDAYS, options } from '@/lib/labels';
import { workDayNumbers } from './_lib';

/** Plain (serializable) employee values for the form. Dates as "YYYY-MM-DD", rate as "1234.50". */
export type EmployeeFormValues = {
  firstName: string; lastName: string; middleName: string; nickname: string; position: string;
  mobile: string; email: string; address: string; birthDate: string; hireDate: string;
  status: string; endDate: string; payType: string; rate: string; payFrequency: string;
  shiftStart: string; shiftEnd: string; breakMinutes: number; workDays: string;
  /** "" = use the shop default grace period. */
  lateGraceMinutes: string;
  sssNo: string; philhealthNo: string; pagibigNo: string; tin: string;
  emergencyContact: string; emergencyPhone: string; notes: string; userId: number | null;
};

export type LinkableUser = { id: number; name: string; username: string; role: string; active: boolean };

export const BLANK_EMPLOYEE: EmployeeFormValues = {
  firstName: '', lastName: '', middleName: '', nickname: '', position: '', mobile: '', email: '', address: '',
  birthDate: '', hireDate: '', status: 'ACTIVE', endDate: '', payType: 'DAILY', rate: '', payFrequency: 'SEMI_MONTHLY',
  shiftStart: '08:00', shiftEnd: '17:00', breakMinutes: 90, workDays: '1,2,3,4,5,6', lateGraceMinutes: '',
  sssNo: '', philhealthNo: '', pagibigNo: '', tin: '', emergencyContact: '', emergencyPhone: '', notes: '', userId: null,
};

function suggestUsername(first: string, last: string) {
  const clean = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const u = [clean(first), clean(last)].filter(Boolean).join('.');
  return u.length >= 3 ? u.slice(0, 32) : '';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-slate-200 pt-3">
      <legend className="pr-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/**
 * Employee profile fields. On edit, pass `recomputeFrom` (default date) to offer recomputing the
 * employee's time records when the schedule (shift / break / work days) changes.
 */
export function EmployeeFields({ e: given, users, recomputeFrom, mode = 'edit', roles = [] }: {
  // Partial so server pages can pass only overrides (a server page importing BLANK_EMPLOYEE from this
  // client module would receive a client reference, not the object).
  e?: Partial<EmployeeFormValues>; users: LinkableUser[]; recomputeFrom?: string;
  /** "new": the login is created together with the employee (required). "edit": link an existing login. */
  mode?: 'new' | 'edit'; roles?: RoleChoice[];
}) {
  const e: EmployeeFormValues = { ...BLANK_EMPLOYEE, ...given };
  const [status, setStatus] = useState(e.status);
  const [payType, setPayType] = useState(e.payType);
  const [sched, setSched] = useState({ shiftStart: e.shiftStart, shiftEnd: e.shiftEnd, breakMinutes: String(e.breakMinutes), grace: e.lateGraceMinutes });
  const [days, setDays] = useState<number[]>(workDayNumbers(e.workDays));
  const separated = status === 'RESIGNED' || status === 'TERMINATED';

  const scheduleChanged = recomputeFrom !== undefined && (
    sched.shiftStart !== e.shiftStart || sched.shiftEnd !== e.shiftEnd || sched.breakMinutes !== String(e.breakMinutes) || sched.grace !== e.lateGraceMinutes
    || [...days].sort((a, b) => a - b).join(',') !== workDayNumbers(e.workDays).join(','));

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  return (
    <div className="space-y-5">
      <Section title="Personal">
        <Field label="First name *"><input name="firstName" defaultValue={e.firstName} required className="input" /></Field>
        <Field label="Last name *"><input name="lastName" defaultValue={e.lastName} required className="input" /></Field>
        <Field label="Middle name"><input name="middleName" defaultValue={e.middleName} className="input" /></Field>
        <Field label="Nickname"><input name="nickname" defaultValue={e.nickname} className="input" /></Field>
        <Field label="Mobile"><input name="mobile" defaultValue={e.mobile} inputMode="tel" placeholder="09xx xxx xxxx" className="input" /></Field>
        <Field label="Email"><input name="email" type="email" defaultValue={e.email} className="input" /></Field>
        <Field label="Address" className="sm:col-span-2"><input name="address" defaultValue={e.address} className="input" /></Field>
        <Field label="Birth date"><input name="birthDate" type="date" defaultValue={e.birthDate} className="input" /></Field>
      </Section>

      <Section title="Employment">
        <Field label="Position *"><input name="position" defaultValue={e.position} required placeholder="e.g. Layout artist" className="input" /></Field>
        <Field label="Hire date *"><input name="hireDate" type="date" defaultValue={e.hireDate} required className="input" /></Field>
        <Field label="Status *">
          <select name="status" value={status} onChange={(ev) => setStatus(ev.target.value)} className="input">
            {options(EMPLOYMENT_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {separated && (
          <Field label="End date *" hint="Last day of work.">
            <input name="endDate" type="date" defaultValue={e.endDate} required className="input" />
          </Field>
        )}
      </Section>

      <Section title="Pay">
        <Field label="Pay type *">
          <select name="payType" value={payType} onChange={(ev) => setPayType(ev.target.value)} className="input">
            {options(PAY_TYPE).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label={payType === 'MONTHLY' ? 'Monthly salary (₱) *' : 'Daily rate (₱) *'}>
          <input name="rate" inputMode="decimal" defaultValue={e.rate} required placeholder="0.00" className="input num" />
        </Field>
        <Field label="Pay frequency *"><Select name="payFrequency" options={options(PAY_FREQUENCY)} defaultValue={e.payFrequency} /></Field>
      </Section>

      <Section title="Work schedule">
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-4">
          <Field label="Shift start *">
            <input name="shiftStart" type="time" required value={sched.shiftStart} onChange={(ev) => setSched({ ...sched, shiftStart: ev.target.value })} className="input" />
          </Field>
          <Field label="Shift end *">
            <input name="shiftEnd" type="time" required value={sched.shiftEnd} onChange={(ev) => setSched({ ...sched, shiftEnd: ev.target.value })} className="input" />
          </Field>
          <Field label="Break (min)">
            <input name="breakMinutes" type="number" min={0} step={1} value={sched.breakMinutes} onChange={(ev) => setSched({ ...sched, breakMinutes: ev.target.value })} className="input num" />
          </Field>
          <Field label="Late grace (min)" hint="Minutes after shift start still on time. Empty = shop default (Settings).">
            <input name="lateGraceMinutes" type="number" min={0} max={120} step={1} value={sched.grace} onChange={(ev) => setSched({ ...sched, grace: ev.target.value })} placeholder="Shop default" className="input num" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <span className="label">Work days *</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map(([d, label]) => {
              const on = days.includes(d);
              return (
                <label key={d} className={`flex h-9 cursor-pointer select-none items-center gap-1.5 rounded border px-3 text-[13px] font-medium transition ${on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}>
                  <input type="checkbox" name="workDays" value={d} checked={on} onChange={() => toggleDay(d)} className="accent-brand-600" />
                  {label}
                </label>
              );
            })}
          </div>
          <span className="mt-1 block text-xs text-slate-500">Days not checked are rest days.</span>
        </div>
        {scheduleChanged && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 sm:col-span-2">
            <label className="flex items-start gap-2">
              <input type="checkbox" name="recompute" value="1" defaultChecked className="mt-0.5 accent-brand-600" />
              <span>
                <strong>Recompute this employee&apos;s time records</strong> (late, undertime, overtime, rest days) with the new schedule, starting from
              </span>
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
              <input name="recomputeFrom" type="date" defaultValue={recomputeFrom} className="input w-auto" />
              <span className="text-xs text-amber-800">Default: the day after the last finalized payroll. Holidays and paid-leave days keep their type.</span>
            </div>
          </div>
        )}
      </Section>

      <Section title="Government numbers">
        <Field label="SSS no."><input name="sssNo" defaultValue={e.sssNo} className="input num" /></Field>
        <Field label="PhilHealth no."><input name="philhealthNo" defaultValue={e.philhealthNo} className="input num" /></Field>
        <Field label="Pag-IBIG no."><input name="pagibigNo" defaultValue={e.pagibigNo} className="input num" /></Field>
        <Field label="TIN"><input name="tin" defaultValue={e.tin} className="input num" /></Field>
      </Section>

      <Section title="Emergency contact & other">
        <Field label="Emergency contact"><input name="emergencyContact" defaultValue={e.emergencyContact} placeholder="Name / relationship" className="input" /></Field>
        <Field label="Emergency phone"><input name="emergencyPhone" defaultValue={e.emergencyPhone} inputMode="tel" className="input" /></Field>
        {mode === 'edit' && (
          <Field label="Linked login" hint="Lets the employee see their own time records and payslips.">
            <select name="userId" defaultValue={e.userId ?? ''} className="input">
              <option value="">— none —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.username}) · {u.role}{u.active ? '' : ' · inactive'}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2"><textarea name="notes" defaultValue={e.notes} rows={2} className="input" /></Field>
      </Section>

      {mode === 'new' && (
        <Section title="Login (required)">
          <div className="sm:col-span-2">
            <p className="mb-3 text-[12.5px] text-slate-600">Every employee gets a login so they can time in, see their own time records and payslips, and (for production) their jobs. Only an admin can create logins.</p>
            <LoginFields roles={roles} suggestedUsername={suggestUsername(e.firstName, e.lastName)} />
          </div>
        </Section>
      )}
    </div>
  );
}
