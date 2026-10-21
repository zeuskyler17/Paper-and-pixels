import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser, can } from '@/lib/auth';
import { centavosToInput, peso } from '@/lib/money';
import { PRICING_MODE } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Card, Empty, PageHeader, TableWrap } from '@/components/ui';
import { createCategory, updateBasePrice, updateCategory } from './actions';

export const metadata = { title: 'Products & Pricing' };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ inactive?: string }> }) {
  const user = await requireUser('products_view');
  const admin = can(user, 'products_edit');
  const { inactive } = await searchParams;
  const showInactive = !!inactive;

  const categories = await prisma.productCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      products: {
        where: showInactive ? {} : { active: true },
        orderBy: { name: 'asc' },
        include: { options: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { name: true } }, _count: { select: { bom: true } } },
      },
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products & Pricing"
        subtitle="Price list used by the POS. Change a base price right here and press Save. Old orders keep the prices and options they were sold with."
        actions={
          <>
            <Link href={showInactive ? '/products' : '/products?inactive=1'} className="btn-secondary">
              {showInactive ? 'Hide inactive' : 'Show inactive'}
            </Link>
            {admin && <Link href="/products/new" className="btn-primary">+ New product</Link>}
          </>
        }
      />

      {categories.length === 0 && <Empty>No product categories yet.{admin ? ' Add one below.' : ''}</Empty>}

      {categories.map((c) => (
        <Card
          key={c.id}
          title={<span className="flex flex-wrap items-center gap-2">{c.name} {c.requiresProduction ? <Badge tone="blue">Goes to production board</Badge> : <Badge>No production job</Badge>}</span>}
          actions={admin ? <Link href={`/products/new?categoryId=${c.id}`} className="btn-secondary btn-sm">+ Add</Link> : undefined}
        >
          {c.products.length === 0 ? <Empty>No products in this category.</Empty> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Product</th><th>Pricing</th><th className="text-right">Base price</th><th>Options</th><th>BOM</th><th>Status</th></tr></thead>
                <tbody>
                  {c.products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/products/${p.id}`} className="link">{p.name}</Link>
                        {p.description && <div className="max-w-xs truncate text-xs text-slate-500">{p.description}</div>}
                      </td>
                      <td>{PRICING_MODE[p.pricingMode]}</td>
                      <td className="text-right whitespace-nowrap">
                        {admin ? (
                          <ActionForm action={updateBasePrice.bind(null, p.id)} className="inline-flex flex-col items-end">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-sm text-slate-500">₱</span>
                              <input name="basePrice" defaultValue={centavosToInput(p.basePrice)} inputMode="decimal" required
                                className="input h-8 w-28 text-right tabular-nums" aria-label={`Base price of ${p.name}`} />
                              <span className="text-xs text-slate-500">/ {p.pricingMode === 'PER_SQFT' ? 'sq ft' : p.unit}</span>
                              <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
                            </span>
                          </ActionForm>
                        ) : (
                          <>{peso(p.basePrice)} <span className="text-xs text-slate-500">/ {p.pricingMode === 'PER_SQFT' ? 'sq ft' : p.unit}</span></>
                        )}
                      </td>
                      <td className="max-w-xs text-xs text-slate-600">{p.options.map((o) => o.name).join(', ') || '—'}</td>
                      <td className="text-xs">{p._count.bom > 0 ? `${p._count.bom} material${p._count.bom > 1 ? 's' : ''}` : '—'}</td>
                      <td>{p.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      ))}

      {admin && (
        <Card title="Categories">
          <p className="mb-3 text-sm text-slate-500">
            When <b>Goes to production</b> is ticked, every order line in that category automatically becomes a job on the production board.
          </p>
          <div className="space-y-2">
            {categories.map((c) => (
              <ActionForm key={c.id} action={updateCategory.bind(null, c.id)} className="rounded-md border border-slate-200 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input name="name" defaultValue={c.name} className="input min-w-[10rem] flex-1" required aria-label="Category name" />
                  <input name="sortOrder" defaultValue={c.sortOrder} className="input w-20" inputMode="numeric" aria-label="Sort order" title="Sort order" />
                  <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="requiresProduction" defaultChecked={c.requiresProduction} /> Goes to production</label>
                  <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
                </div>
              </ActionForm>
            ))}
            <ActionForm action={createCategory} resetOnSuccess className="rounded-md border border-dashed border-slate-300 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <input name="name" placeholder="New category name" className="input min-w-[10rem] flex-1" required />
                <input name="sortOrder" defaultValue={categories.length + 1} className="input w-20" inputMode="numeric" aria-label="Sort order" title="Sort order" />
                <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="requiresProduction" defaultChecked /> Goes to production</label>
                <SubmitButton className="btn-primary btn-sm">+ Add category</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </Card>
      )}
    </div>
  );
}
