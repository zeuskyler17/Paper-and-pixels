import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { todayManila } from '@/lib/dates';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, PageHeader } from '@/components/ui';
import { createEmployee } from '../actions';
import { EmployeeFields } from '../EmployeeFields';
import { linkableUsers } from '../_data';
import { roleOptions } from '../../users/_tabs';

export const metadata = { title: 'New employee' };

export default async function NewEmployeePage() {
  await requireUser('admin'); // creating an employee also creates their login — admin only
  const [users, roles] = await Promise.all([linkableUsers(), roleOptions()]);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New employee"
        subtitle="The employee number is assigned automatically. Their login is created at the same time; set the time-clock PIN after saving."
        actions={<Link href="/employees" className="btn-secondary">Back to employees</Link>}
      />
      <Card>
        <ActionForm action={createEmployee} className="space-y-4">
          <EmployeeFields e={{ hireDate: todayManila() }} users={users} mode="new" roles={roles} />
          <SubmitButton>Save employee & create login</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
