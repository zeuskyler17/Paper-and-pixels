'use client';

import { useState } from 'react';
import { PERMISSIONS } from '@/lib/permissions';
import { RoleFields } from './roles/RoleForm';

export type RoleChoice = { id: number; name: string; isAdmin: boolean; permissions: string[] };

const LABEL = new Map<string, string>(PERMISSIONS.map((p) => [p.key, p.label]));

/** Role dropdown for the user forms: pick an existing role (shows what it opens) or "+ New role" to type one and tick its access. */
export function RolePicker({ roles, defaultValue, disabled }: { roles: RoleChoice[]; defaultValue?: number | null; disabled?: boolean }) {
  const [value, setValue] = useState(defaultValue ? String(defaultValue) : '');
  const chosen = roles.find((r) => String(r.id) === value);

  return (
    <div className="space-y-3">
      <label className="block max-w-md">
        <span className="label">Role *</span>
        <select name="accessRoleId" value={value} onChange={(e) => setValue(e.target.value)} required disabled={disabled} className="input">
          <option value="">Choose a role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.isAdmin ? `${r.name} — full access` : r.name}</option>)}
          <option value="new">+ New role — type a name and tick what they can open</option>
        </select>
        {disabled && <input type="hidden" name="accessRoleId" value={value} />}
      </label>

      {value === 'new' && (
        <div className="rounded border border-brand-200 bg-brand-50/40 p-4">
          <p className="mb-3 text-[13px] font-semibold text-slate-700">New role — it is saved together with this user and can be picked for others later.</p>
          <RoleFields prefix="role_" />
        </div>
      )}

      {chosen && (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[13px]">
          <div className="mb-1.5 font-semibold text-slate-700">
            {chosen.name} can open:
            {!chosen.isAdmin && <a href={`/users/roles/${chosen.id}`} target="_blank" className="link ml-2 font-normal">Change this role’s access ↗</a>}
          </div>
          {chosen.isAdmin ? <span>Everything (full access, locked).</span>
            : chosen.permissions.length === 0 ? <span className="text-slate-500">Time clock only.</span>
            : <div className="flex flex-wrap gap-1">{chosen.permissions.map((p) => <span key={p} className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200">{LABEL.get(p) ?? p}</span>)}</div>}
        </div>
      )}
    </div>
  );
}
