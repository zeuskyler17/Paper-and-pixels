import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { Badge, Card, Empty, FilterBar, PageHeader, Stat, TableWrap } from '@/components/ui';
import { PAYABLE_FORMULA, supplierPayables } from './_payables';

export const metadata = { title: 'Suppliers' };

type SP = Promise<{ q?: string; owing?: string; inactive?: string }>;

export default async function SuppliersPage({ searchParams }: { searchParams: SP }) {
  await requireUser('purchasing');
  const { q = '', owing, inactive } = await searchParams;

  const where: Prisma.SupplierWhereInput = {
    ...(inactive ? {} : { active: true }),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { contactPerson: { contains: q, mode: 'insensitive' } }, { mobile: { contains: q } }] } : {}),
  };
  const suppliers = await prisma.supplier.findMany({ where, orderBy: { name: 'asc' } });
  const payables = await supplierPayables(suppliers.map((s) => s.id));
  let rows = suppliers.map((s) => ({ ...s, balance: payables.get(s.id)?.balance ?? 0 }));
  if (owing) rows = rows.filter((r) => r.balance > 0);
  const totalOwed = rows.reduce((t, r) => t + Math.max(0, r.balance), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Suppliers" subtitle={`${rows.length} suppliers`} actions={<Link href="/suppliers/new" className="btn-primary">+ New supplier</Link>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Total payables" value={peso(totalOwed)} tone={totalOwed > 0 ? 'red' : 'green'} hint="Owed to the suppliers listed" />
      </div>
      <Card>
        <FilterBar>
          <input name="q" defaultValue={q} placeholder="Search name, contact, mobile" className="input w-64" />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="owing" value="1" defaultChecked={!!owing} /> With payable only</label>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="inactive" value="1" defaultChecked={!!inactive} /> Include inactive</label>
        </FilterBar>
        {rows.length === 0 ? <Empty>No suppliers found.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Name</th><th>Contact person</th><th>Mobile</th><th>Payment terms</th><th className="text-right">Payable balance</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/suppliers/${s.id}`} className="link">{s.name}</Link>{!s.active && <span className="ml-1"><Badge>Inactive</Badge></span>}</td>
                    <td>{s.contactPerson ?? '—'}</td>
                    <td>{s.mobile ?? '—'}</td>
                    <td>{s.paymentTerms ?? '—'}</td>
                    <td className={`text-right font-semibold ${s.balance > 0 ? 'text-red-600' : 'text-slate-500'}`}>{peso(s.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className="mt-3 text-xs text-slate-500">{PAYABLE_FORMULA}</p>
      </Card>
    </div>
  );
}
