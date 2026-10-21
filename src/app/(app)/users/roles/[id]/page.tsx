import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Card, PageHeader } from '@/components/ui';
import { RoleFields } from '../RoleForm';
import { deleteRole, updateRole } from '../actions';

export const metadata = { title: 'Role' };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('admin');
  const { id } = await params;
  const role = await prisma.accessRole.findUnique({
    where: { id: Number(id) || 0 },
    include: { users: { select: { id: true, name: true, active: true }, orderBy: [{ active: 'desc' }, { name: 'asc' }] } },
  });
  if (!role) notFound();

  const people = (
    <Card title={`People with this role (${role.users.length})`}>
      {role.users.length === 0 ? <p className="text-sm text-slate-500">Nobody has this role yet. Pick it when adding or editing a user.</p> : (
        <div className="flex flex-wrap gap-2">
          {role.users.map((u) => (
            <Link key={u.id} href={`/users/${u.id}`} className={`rounded border border-slate-200 px-2.5 py-1 text-sm hover:bg-slate-50 ${u.active ? '' : 'text-slate-400 line-through'}`}>{u.name}</Link>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title={role.name} subtitle={role.description ?? (role.isAdmin ? 'Owner / administrator' : 'Custom role')}
        actions={<Link href="/users/roles" className="btn-secondary">Back to roles</Link>} />

      {role.isAdmin ? (
        <Card>
          <div className="flex items-start gap-3">
            <Badge tone="purple">Locked</Badge>
            <p className="text-sm text-slate-700">
              The Admin (owner) role always has full access to every module, plus users &amp; roles and the approval PIN.
              It cannot be edited or deleted, so you can never lock yourself out.
            </p>
          </div>
        </Card>
      ) : (
        <Card title="Name & access">
          <ActionForm action={updateRole.bind(null, role.id)} className="space-y-5">
            <RoleFields name={role.name} description={role.description} permissions={role.permissions} />
            <SubmitButton>Save role</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {people}

      {!role.isAdmin && (
        <Card title="Delete role">
          {role.users.length > 0
            ? <p className="text-sm text-slate-500">Move the {role.users.length} user(s) above to another role before deleting this one.</p>
            : (
              <ActionForm action={deleteRole.bind(null, role.id)} confirm={`Delete the role "${role.name}"?`}>
                <SubmitButton className="btn-danger">Delete role</SubmitButton>
              </ActionForm>
            )}
        </Card>
      )}
    </div>
  );
}
