import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Empty, PageHeader } from '@/components/ui';
import { createProduct } from '../actions';
import { ProductFields } from '../ProductFields';
import { CopyOptionsField } from '../CopyOptionsField';
import { copySources } from '../_copySources';

export const metadata = { title: 'New product' };

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ categoryId?: string }> }) {
  await requireUser('products_edit');
  const { categoryId } = await searchParams;
  const [categories, sources] = await Promise.all([
    prisma.productCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    copySources(),
  ]);
  const initialCategoryId = categoryId ? Number(categoryId) : undefined;

  return (
    <div className="max-w-2xl">
      <PageHeader title="New product" subtitle="Pick a category — options and add-on prices are copied from a product in the same category. You can change them after saving." />
      <Card>
        {categories.length === 0 ? (
          <Empty>Add a product category first on the <Link href="/products" className="link">Products page</Link>.</Empty>
        ) : (
          <ActionForm action={createProduct} className="space-y-4">
            <ProductFields categories={categories} p={{ categoryId: initialCategoryId }} />
            {sources.length > 0 && <CopyOptionsField sources={sources} followCategory initialCategoryId={initialCategoryId} />}
            <SubmitButton>Save product</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
