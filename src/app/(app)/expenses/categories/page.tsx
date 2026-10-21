import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { createCategory, updateCategory } from '../actions';

export const metadata = { title: 'Expense categories' };

export default async function ExpenseCategoriesPage() {
  await requireUser('expenses_manage');
  const categories = await prisma.expenseCategory.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { expenses: true } } },
  });

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Expense categories"
        subtitle="Inactive categories stay on old expenses but can no longer be chosen."
        actions={<Link href="/expenses" className="btn-secondary">← Expenses</Link>}
      />

      <Card title="Add category">
        <ActionForm action={createCategory} resetOnSuccess className="flex flex-wrap items-end gap-2">
          <label className="min-w-[12rem] flex-1"><span className="label">Name</span><input name="name" required className="input" /></label>
          <SubmitButton>Add</SubmitButton>
        </ActionForm>
      </Card>

      <Card title="Categories">
        {categories.length === 0 ? <Empty>No categories yet.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {categories.map((c) => (
              <li key={c.id} className="py-3">
                <ActionForm action={updateCategory.bind(null, c.id)} className="flex flex-wrap items-center gap-2">
                  <input name="name" defaultValue={c.name} required className="input min-w-[10rem] flex-1" aria-label="Category name" />
                  <label className="flex items-center gap-1 text-sm">
                    <input type="checkbox" name="active" defaultChecked={c.active} /> Active
                  </label>
                  <span className="text-xs text-slate-500">{c._count.expenses} expenses</span>
                  {!c.active && <Badge tone="red">Inactive</Badge>}
                  <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
