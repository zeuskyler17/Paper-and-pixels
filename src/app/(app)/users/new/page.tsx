import { requireUser } from '@/lib/auth';
import { roleOptions } from '../_tabs';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Field, PageHeader } from '@/components/ui';
import { RolePicker } from '../RolePicker';
import { createUser } from '../actions';

export const metadata = { title: 'New user' };

export default async function NewUserPage() {
  await requireUser('admin');
  const roles = await roleOptions();
  return (
    <div className="max-w-5xl">
      <PageHeader title="New user" />
      <Card>
        <ActionForm action={createUser} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name *"><input name="name" className="input" required /></Field>
            <Field label="Username *" hint="Lowercase, used to log in (e.g. maria).">
              <input name="username" className="input lowercase" required autoCapitalize="none" autoComplete="off" pattern="[a-zA-Z0-9._\-]{3,32}" />
            </Field>
            <div className="sm:col-span-2"><RolePicker roles={roles} /></div>
            <Field label="Initial password *" hint="At least 6 characters. Ask them to change it after logging in.">
              <input name="password" type="password" className="input" minLength={6} required autoComplete="new-password" />
            </Field>
            <Field label="Confirm password *">
              <input name="confirm" type="password" className="input" minLength={6} required autoComplete="new-password" />
            </Field>
          </div>
          <SubmitButton>Create user</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
