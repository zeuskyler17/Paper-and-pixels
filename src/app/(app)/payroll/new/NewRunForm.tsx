'use client';

import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { createRun } from '../actions';
import type { PeriodPreset } from '../_lib';

type Freq = 'SEMI_MONTHLY' | 'WEEKLY';

export function NewRunForm({ presets, defaultFrequency }: { presets: Record<Freq, PeriodPreset[]>; defaultFrequency: Freq }) {
  const [frequency, setFrequency] = useState<Freq>(defaultFrequency);
  const first = presets[defaultFrequency][0];
  const [from, setFrom] = useState(first?.from ?? '');
  const [to, setTo] = useState(first?.to ?? '');
  const [payDate, setPayDate] = useState(first?.payDate ?? '');
  const [payTouched, setPayTouched] = useState(false);

  function apply(p: PeriodPreset) {
    setFrom(p.from);
    setTo(p.to);
    setPayDate(p.payDate);
    setPayTouched(false);
  }

  function changeFrequency(f: Freq) {
    setFrequency(f);
    if (presets[f][0]) apply(presets[f][0]);
  }

  const days = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : 0;

  return (
    <ActionForm action={createRun} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Pay frequency</span>
          <select name="frequency" value={frequency} onChange={(e) => changeFrequency(e.target.value as Freq)} className="input">
            <option value="SEMI_MONTHLY">Semi-monthly (15th & end of month)</option>
            <option value="WEEKLY">Weekly</option>
          </select>
          <span className="mt-1 block text-xs text-slate-500">Only employees paid on this frequency are included.</span>
        </label>
      </div>

      <div>
        <span className="label">Quick periods</span>
        <div className="flex flex-wrap gap-2">
          {presets[frequency].map((p) => {
            const active = p.from === from && p.to === to;
            return (
              <button key={p.label} type="button" onClick={() => apply(p)} className={`${active ? 'btn-dark' : 'btn-secondary'} btn-sm`}>
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">Period from</span>
          <input type="date" name="from" value={from} onChange={(e) => setFrom(e.target.value)} className="input" required />
        </label>
        <label className="block">
          <span className="label">Period to</span>
          <input
            type="date" name="to" value={to} required className="input"
            onChange={(e) => { setTo(e.target.value); if (!payTouched) setPayDate(e.target.value); }}
          />
          {days > 0 && <span className={`mt-1 block text-xs ${days > 31 ? 'text-red-600' : 'text-slate-500'}`}>{days} day(s){days > 31 ? ' — max 31' : ''}</span>}
          {days < 0 && <span className="mt-1 block text-xs text-red-600">End is before start</span>}
        </label>
        <label className="block">
          <span className="label">Pay date</span>
          <input type="date" name="payDate" value={payDate} onChange={(e) => { setPayDate(e.target.value); setPayTouched(true); }} className="input" required />
        </label>
      </div>

      <label className="block">
        <span className="label">Notes</span>
        <textarea name="notes" rows={2} className="input" placeholder="Optional" />
      </label>

      <p className="text-xs text-slate-500">
        Payslips are generated from the time records of the period. The run starts as a <b>draft</b>: you can review it,
        add allowances or deductions, and recalculate after fixing time records before finalizing.
      </p>
      <SubmitButton>Create &amp; generate payslips</SubmitButton>
    </ActionForm>
  );
}
