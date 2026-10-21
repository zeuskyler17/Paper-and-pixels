'use client';

import { Field } from '@/components/ui';

export type RoleChoice = { id: number; name: string; isAdmin: boolean };

/** Username / role / password for a new login. Field names are prefixed (login_…) so the employee form can embed them. */
export function LoginFields({ roles, prefix = 'login_', suggestedUsername = '' }: { roles: RoleChoice[]; prefix?: string; suggestedUsername?: string }) {
  const staffRoles = roles.filter((r) => !r.isAdmin);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Username *" hint="Lowercase, used to log in (e.g. maria).">
        <input name={`${prefix}username`} defaultValue={suggestedUsername} className="input lowercase" required autoCapitalize="none" autoComplete="off" pattern="[a-zA-Z0-9._\-]{3,32}" />
      </Field>
      <Field label="Role *" hint="What this person can open. Manage roles under Employees & Users → Roles & access.">
        <select name={`${prefix}accessRoleId`} defaultValue="" required className="input">
          <option value="">Choose a role…</option>
          {staffRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Initial password *" hint="At least 6 characters. Ask them to change it after logging in.">
        <input name={`${prefix}password`} type="password" className="input" minLength={6} required autoComplete="new-password" />
      </Field>
      <Field label="Confirm password *">
        <input name={`${prefix}confirm`} type="password" className="input" minLength={6} required autoComplete="new-password" />
      </Field>
    </div>
  );
}
