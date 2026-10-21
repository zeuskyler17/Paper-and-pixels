import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fmtDateTime, manilaDayRange, parseDateInput } from '@/lib/dates';
import { Badge, Card, Empty, FilterBar, PageHeader, TableWrap } from '@/components/ui';

export const metadata = { title: 'Audit log' };

const PAGE_SIZE = 50;

const ENTITY_ROUTES: Record<string, string> = {
  Order: '/orders',
  Customer: '/customers',
  Job: '/jobs',
  Material: '/inventory',
  PurchaseOrder: '/purchase-orders',
  Supplier: '/suppliers',
};

const ACTION_TONE: Record<string, 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'purple'> = {
  CREATE: 'green', UPDATE: 'blue', STATUS: 'purple', VOID: 'red', CANCEL: 'red', OVERRIDE: 'amber', DELETE: 'red',
};

type SP = Promise<{ user?: string; entity?: string; action?: string; from?: string; to?: string; q?: string; page?: string }>;

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  await requireUser('audit');
  const sp = await searchParams;
  const userId = sp.user === 'system' ? 'system' : Number(sp.user) || null;
  const entity = sp.entity?.trim() || '';
  const action = sp.action?.trim() || '';
  const q = sp.q?.trim() || '';
  const from = parseDateInput(sp.from) ? sp.from! : '';
  const to = parseDateInput(sp.to) ? sp.to! : '';
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  const createdAt: Prisma.DateTimeFilter = {};
  if (from) createdAt.gte = manilaDayRange(from).start;
  if (to) createdAt.lt = manilaDayRange(to).end;

  const where: Prisma.AuditLogWhereInput = {
    ...(userId === 'system' ? { userId: null } : userId ? { userId } : {}),
    ...(entity ? { entity } : {}),
    ...(action ? { action } : {}),
    ...(q ? { summary: { contains: q, mode: 'insensitive' } } : {}),
    ...(from || to ? { createdAt } : {}),
  };

  const [logs, total, users, entities, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { name: true, username: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (n: number) => {
    const u = new URLSearchParams();
    if (sp.user) u.set('user', sp.user);
    if (entity) u.set('entity', entity);
    if (action) u.set('action', action);
    if (from) u.set('from', from);
    if (to) u.set('to', to);
    if (q) u.set('q', q);
    if (n > 1) u.set('page', String(n));
    const s = u.toString();
    return s ? `/audit?${s}` : '/audit';
  };

  return (
    <div>
      <PageHeader title="Audit log" subtitle={`${total.toLocaleString('en-PH')} entries · every create, update, void and status change`} />
      <Card>
        <FilterBar>
          <label>
            <span className="label">User</span>
            <select name="user" defaultValue={sp.user ?? ''} className="input w-auto">
              <option value="">All users</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              <option value="system">(System / no user)</option>
            </select>
          </label>
          <label>
            <span className="label">Entity</span>
            <select name="entity" defaultValue={entity} className="input w-auto">
              <option value="">All</option>
              {entities.map((e) => <option key={e.entity} value={e.entity}>{e.entity}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Action</span>
            <select name="action" defaultValue={action} className="input w-auto">
              <option value="">All</option>
              {actions.map((a) => <option key={a.action} value={a.action}>{a.action}</option>)}
            </select>
          </label>
          <label><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input w-auto" /></label>
          <label><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input w-auto" /></label>
          <label><span className="label">Search summary</span><input name="q" defaultValue={q} placeholder="e.g. PP-2026-00012" className="input w-56" /></label>
          {(sp.user || entity || action || from || to || q) && <Link href="/audit" className="btn-secondary">Clear</Link>}
        </FilterBar>

        {logs.length === 0 ? <Empty>No audit entries match these filters.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>ID</th><th>Summary</th></tr></thead>
              <tbody>
                {logs.map((l) => {
                  const base = ENTITY_ROUTES[l.entity];
                  return (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                      <td className="whitespace-nowrap">{l.user ? l.user.name : <span className="text-slate-400">System</span>}</td>
                      <td><Badge tone={ACTION_TONE[l.action] ?? 'gray'}>{l.action}</Badge></td>
                      <td>{l.entity}</td>
                      <td>{base && /^\d+$/.test(l.entityId) ? <Link href={`${base}/${l.entityId}`} className="link">{l.entityId}</Link> : l.entityId}</td>
                      <td className="min-w-[16rem] max-w-xl">
                        <div>{l.summary}</div>
                        {l.data !== null && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-slate-500">Data</summary>
                            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-xs text-slate-700">
                              {JSON.stringify(l.data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}

        {pages > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-500">Page {page} of {pages}</span>
            <div className="flex gap-2">
              {page > 1 ? <Link href={pageHref(1)} className="btn-secondary btn-sm">« First</Link> : null}
              {page > 1 ? <Link href={pageHref(page - 1)} className="btn-secondary btn-sm">‹ Previous</Link> : null}
              {page < pages ? <Link href={pageHref(page + 1)} className="btn-secondary btn-sm">Next ›</Link> : null}
              {page < pages ? <Link href={pageHref(pages)} className="btn-secondary btn-sm">Last »</Link> : null}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
