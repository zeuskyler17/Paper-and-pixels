'use client';

import { useState } from 'react';
import { PERMISSION_GROUPS, PERMISSIONS } from '@/lib/permissions';

/** Name, description and grouped permission checkboxes for a role. */
export function RoleFields({ name = '', description = '', permissions = [], prefix = '' }: { name?: string; description?: string | null; permissions?: string[]; prefix?: string }) {
  const [checked, setChecked] = useState<Set<string>>(new Set(permissions));
  const toggle = (k: string, on: boolean) => setChecked((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });
  const setAll = (on: boolean) => setChecked(on ? new Set(PERMISSIONS.map((p) => p.key)) : new Set());

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Role name *</span>
          <input name={`${prefix}name`} defaultValue={name} required maxLength={60} className="input" placeholder="e.g. Front desk, Helper, Supervisor" />
        </label>
        <label className="block"><span className="label">Description</span>
          <input name={`${prefix}description`} defaultValue={description ?? ''} className="input" placeholder="Who this role is for" />
        </label>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="label mb-0">What this role can open ({checked.size} of {PERMISSIONS.length})</span>
          <span className="flex gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setAll(true)}>Select all</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setAll(false)}>None</button>
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {PERMISSION_GROUPS.map((g) => (
            <fieldset key={g} className="rounded border border-slate-200 p-3">
              <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">{g}</legend>
              <div className="space-y-2">
                {PERMISSIONS.filter((p) => p.group === g).map((p) => (
                  <label key={p.key} className="flex cursor-pointer items-start gap-2.5 rounded px-1 py-1 hover:bg-slate-50">
                    <input type="checkbox" name={`${prefix}perm`} value={p.key} checked={checked.has(p.key)}
                      onChange={(e) => toggle(p.key, e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#1452d9]" />
                    <span>
                      <span className="block text-[13px] font-semibold text-slate-800">{p.label}</span>
                      <span className="block text-[12px] leading-snug text-slate-500">{p.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-slate-500">
          Always allowed for everyone: Time Clock, My Time &amp; Pay, My account. Only the Admin (owner) role can manage users &amp; roles and set the approval PIN.
        </p>
      </div>
    </div>
  );
}
