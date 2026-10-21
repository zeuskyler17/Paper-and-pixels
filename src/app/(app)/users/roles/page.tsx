import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { PERMISSIONS } from '@/lib/permissions';
import { PeopleTabs } from '../_tabs';
import { Badge, Card, PageHeader, TableWrap } from '@/components/ui';

export const metadata = { title: 'Roles & access' };

const LABEL = new Map<string, string>(PERMISSIONS.map((p) => [p.key, p.label]));

export default async function RolesPage() {
  const me = await requireUser('admin');
  const roles = await prisma.accessRole.findMany({
    orderBy: [{ isAdmin: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { users: { where: { active: true } } } } },
  });

  return (
    <div>
      <PageHeader
        title="Employees & Users"
        subtitle="Make roles and tick what each one can open. Changes apply to everyone with that role right away."
        actions={<Link href="/users/roles/new" className="btn-primary">+ New role</Link>}
      />
      <PeopleTabs active="roles" user={me} />
      <Card>
        <TableWrap>
          <table className="table">
            <thead><tr><th>Role</th><th>Can open</th><th className="text-right">Active users</th></tr></thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id}>
                  <td className="align-top">
                    <Link href={`/users/roles/${r.id}`} className="link font-semibold">{r.name}</Link>
                    {r.isAdmin && <span className="ml-2"><Badge tone="purple">Locked</Badge></span>}
                    {r.description && <div className="mt-0.5 text-xs text-slate-500">{r.description}</div>}
                  </td>
                  <td className="align-top">
                    {r.isAdmin ? <span className="text-sm font-semibold text-slate-700">Everything (full access)</span>
                      : r.permissions.length === 0 ? <span className="text-sm text-slate-400">Time clock only</span>
                      : <div className="flex flex-wrap gap-1">{r.permissions.map((p) => <Badge key={p} tone="blue">{LABEL.get(p) ?? p}</Badge>)}</div>}
                  </td>
                  <td className="text-right align-top tabular-nums">{r._count.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Everyone can always use the Time Clock and My account. Voids and discounts still need the owner’s approval PIN whatever the role.
      </p>
    </div>
  );
}
