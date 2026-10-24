import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser, can } from '@/lib/auth';
import { todayManila } from '@/lib/dates';
import { Empty, PageHeader } from '@/components/ui';
import { POS_PRODUCT_INCLUDE, toPosProduct, type PosCustomer } from '../_lib';
import { PosForm } from './PosForm';
import { getPointsConfig } from '@/lib/points';

export const metadata = { title: 'New order' };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const user = await requireUser('orders');
  const { customerId } = await searchParams;

  const [rows, prefill] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      include: POS_PRODUCT_INCLUDE,
      orderBy: [{ category: { sortOrder: 'asc' } }, { category: { name: 'asc' } }, { name: 'asc' }],
    }),
    customerId
      ? prisma.customer.findUnique({ where: { id: Number(customerId) || 0 }, select: { id: true, name: true, mobile: true, facebook: true, isInternal: true, specialDiscountPct: true, specialPrices: { select: { productId: true, amountOff: true } }, points: true } })
      : Promise.resolve(null),
  ]);
  const products = rows.map(toPosProduct);
  const accounts = await prisma.paymentAccount.findMany({
    where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: { id: true, method: true, label: true, accountNumber: true },
  });
  const initialCustomer: PosCustomer | null = prefill;
  const pc = await getPointsConfig();
  const pointsCfg = { enabled: pc.enabled, value: pc.valueCentavos, weekCap: pc.weekCap };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New order" subtitle="Customer → items → payment. Prices are re-checked when you save." />
      {products.length === 0 ? (
        <Empty>
          No active products yet.{' '}
          {can(user, 'products_edit') ? <Link href="/products/new" className="link">Add a product</Link> : 'Ask the owner to set up the price list.'}
        </Empty>
      ) : (
        <PosForm products={products} initialCustomer={initialCustomer} today={todayManila()} accounts={accounts} points={pointsCfg} />
      )}
    </div>
  );
}
