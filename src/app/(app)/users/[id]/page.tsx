import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { roleOptions } from '../_tabs';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, DL, Empty, Field, PageHeader, TableWrap } from '@/components/ui';
import { RolePicker } from '../RolePicker';
import { resetPassword, updateUser } from '../actions';

export const metadata = { title: 'User' };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser('admin');
  const roles = await roleOptions();
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id: Number(id) || 0 },
    select: { id: true, name: true, username: true, active: true, createdAt: true, updatedAt: true, accessRoleId: true, accessRole: { select: { name: true } }, employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } },
  });
  if (!user) notFound();
  const isMe = user.id === me.id;

  const [lastLogin, recent] = await Promise.all([
    prisma.auditLog.findFirst({ where: { userId: user.id, action: 'LOGIN' }, orderBy: { createdAt: 'desc' } }),
    prisma.auditLog.findMany({ where: { entity: 'User', entityId: String(user.id), action: { not: 'LOGIN' } }, orderBy: { createdAt: 'desc' }, take: 10, include: { user: { select: { name: true } } } }),
  ]);

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title={user.name}
        subtitle={<>@{user.username} · {user.accessRole?.name ?? 'No role'}{!user.active && ' · Inactive'}{isMe && ' · this is you'}</>}
        actions={<Link href="/users" className="btn-secondary">Back to users</Link>}
      />

      <Card>
        <DL items={[
          ['Username', user.username],
          ['Added', fmtDate(user.createdAt)],
          ['Last login', lastLogin ? fmtDateTime(lastLogin.createdAt) : 'Never'],
          ['Employee record', user.employee ? <Link key="emp" href={`/employees/${user.employee.id}`} className="link">{user.employee.firstName} {user.employee.lastName} · {user.employee.employeeNo}</Link> : <span key="emp" className="text-slate-400">Not linked — open the employee and set “Linked login”</span>],
        ]} />
      </Card>

      <Card title="Edit user">
        <ActionForm action={updateUser.bind(null, user.id)} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name *"><input name="name" defaultValue={user.name} className="input" required /></Field>
            <div className="sm:col-span-2">
              <RolePicker roles={roles} defaultValue={user.accessRoleId} disabled={isMe} />
              {isMe && <p className="mt-1 text-xs text-slate-500">You cannot change your own role.</p>}
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="active" defaultChecked={user.active} disabled={isMe} />
              Active (can log in)
              {isMe && <input type="hidden" name="active" value="on" />}
            </label>
          </div>
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>

      <Card title="Reset password">
        <ActionForm action={resetPassword.bind(null, user.id)} resetOnSuccess className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="New password *"><input name="password" type="password" className="input" minLength={6} required autoComplete="new-password" /></Field>
            <Field label="Confirm new password *"><input name="confirm" type="password" className="input" minLength={6} required autoComplete="new-password" /></Field>
          </div>
          <SubmitButton className="btn-secondary">Reset password</SubmitButton>
        </ActionForm>
      </Card>

      <Card title="Account history">
        {recent.length === 0 ? <Empty>No changes recorded.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>When</th><th>By</th><th>What</th></tr></thead>
              <tbody>
                {recent.map((a) => (
                  <tr key={a.id}><td className="whitespace-nowrap">{fmtDateTime(a.createdAt)}</td><td>{a.user?.name ?? '—'}</td><td>{a.summary}</td></tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
