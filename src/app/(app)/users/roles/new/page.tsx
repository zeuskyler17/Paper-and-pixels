import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, PageHeader } from '@/components/ui';
import { RoleFields } from '../RoleForm';
import { createRole } from '../actions';

export const metadata = { title: 'New role' };

export default async function NewRolePage() {
  await requireUser('admin');
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="New role" subtitle="Name the role and tick what people with it can open."
        actions={<Link href="/users/roles" className="btn-secondary">Back to roles</Link>} />
      <Card>
        <ActionForm action={createRole} className="space-y-5">
          <RoleFields />
          <SubmitButton>Create role</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
