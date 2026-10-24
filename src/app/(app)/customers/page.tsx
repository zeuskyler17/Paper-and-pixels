import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { customerBalances } from '@/lib/orders';
import { peso } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { Card, Empty, FilterBar, PageHeader, TableWrap, Badge } from '@/components/ui';

export const metadata = { title: 'Customers' };

type SP = Promise<{ q?: string; sort?: string; owing?: string }>;

export default async function CustomersPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser('customers');
  const { q = '', sort = 'balance', owing } = await searchParams;

  const where: Prisma.CustomerWhereInput = q
    ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { mobile: { contains: q } }, { facebook: { contains: q, mode: 'insensitive' } }] }
    : {};
  const customers = await prisma.customer.findMany({ where, orderBy: { name: 'asc' }, take: 500, include: { _count: { select: { specialPrices: true } } } });
  const balances = await customerBalances(customers.map((c) => c.id));

  // Balances the owner hid from staff count as hidden (not 0) for non-admin logins: not shown, not sorted, not in "with balance only".
  let rows = customers.map((c) => ({ ...c, hidden: c.balanceHidden && !user.isAdmin, balance: c.balanceHidden && !user.isAdmin ? 0 : balances.get(c.id)?.balance ?? 0, lastOrder: balances.get(c.id)?.lastOrder ?? null }));
  if (owing) rows = rows.filter((r) => r.balance > 0);
  if (sort === 'balance') rows.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  if (sort === 'recent') rows.sort((a, b) => (b.lastOrder?.getTime() ?? 0) - (a.lastOrder?.getTime() ?? 0));

  return (
    <div>
      <PageHeader title="Customers" subtitle={`${rows.length} customers`} actions={<Link href="/customers/new" className="btn-primary">+ New customer</Link>} />
      <Card>
        <FilterBar>
          <input name="q" defaultValue={q} placeholder="Search name, mobile, Facebook" className="input w-64" />
          <select name="sort" defaultValue={sort} className="input w-auto">
            <option value="balance">Sort: highest balance</option>
            <option value="name">Sort: name</option>
            <option value="recent">Sort: last order</option>
          </select>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="owing" value="1" defaultChecked={!!owing} /> With balance only</label>
        </FilterBar>
        {rows.length === 0 ? <Empty>No customers found.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Name</th><th>Mobile</th><th>Facebook</th><th>Last order</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/customers/${c.id}`} className="link">{c.name}</Link>{c.isInternal && <span className="ml-1"><Badge tone="amber">Branch</Badge></span>}{c._count.specialPrices ? <span className="ml-1"><Badge tone="green">Special discount</Badge></span> : null}</td>
                    <td>{c.mobile ?? '—'}</td>
                    <td className="max-w-[12rem] truncate">{c.facebook ?? '—'}</td>
                    <td>{fmtDate(c.lastOrder)}</td>
                    {c.hidden
                      ? <td className="text-right text-slate-400">Hidden</td>
                      : <td className={`text-right font-semibold ${c.balance > 0 ? 'text-red-600' : 'text-slate-500'}`}>{peso(c.balance)}{user.isAdmin && c.balanceHidden && <div className="text-[10.5px] font-normal text-slate-400">hidden from staff</div>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
