import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fmtDate } from '@/lib/dates';
import { PeopleTabs } from './_tabs';
import { Badge, Card, Empty, PageHeader, TableWrap } from '@/components/ui';

export const metadata = { title: 'Users' };

export default async function UsersPage() {
  const me = await requireUser('admin');
  const users = await prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { accessRole: { sortOrder: 'asc' } }, { name: 'asc' }],
    select: { id: true, name: true, username: true, active: true, createdAt: true, accessRole: { select: { name: true, isAdmin: true } }, employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Employees & Users"
        subtitle="Logins for the app. What each person can open is set by their role — see Roles & access. HR details (rate, schedule, PIN) are on the Employees tab."
        actions={<Link href="/users/new" className="btn-primary">+ New user</Link>}
      />
      <PeopleTabs active="users" user={me} />
      <Card>
        {users.length === 0 ? <Empty>No users yet.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Employee record</th><th>Status</th><th>Added</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'text-slate-400'}>
                    <td>
                      <Link href={`/users/${u.id}`} className="link">{u.name}</Link>
                      {u.id === me.id && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                    </td>
                    <td className="font-mono text-xs">{u.username}</td>
                    <td><Badge tone={u.accessRole?.isAdmin ? 'purple' : u.accessRole ? 'blue' : 'red'}>{u.accessRole?.name ?? 'No role'}</Badge></td>
                    <td>{u.employee ? <Link href={`/employees/${u.employee.id}`} className="link">{u.employee.firstName} {u.employee.lastName} <span className="text-xs text-slate-500">{u.employee.employeeNo}</span></Link> : <span className="text-xs text-slate-400">not linked</span>}</td>
                    <td>{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}</td>
                    <td>{fmtDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Change what a role can open under <a href="/users/roles" className="link">Roles &amp; access</a>; changes apply immediately. Deactivated users are logged out immediately; their history is kept.
      </p>
    </div>
  );
}
