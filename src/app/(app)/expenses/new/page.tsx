import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser, can } from '@/lib/auth';
import { todayManila } from '@/lib/dates';
import { PAYMENT_METHOD, options } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { ImageUpload } from '@/components/ImageUpload';
import { Card, Empty, Field, PageHeader, Select } from '@/components/ui';
import { createExpense } from '../actions';
import { CategoryField } from '../CategoryField';

export const metadata = { title: 'Add expense' };

export default async function NewExpensePage() {
  const user = await requireUser('expenses');
  const categories = await prisma.expenseCategory.findMany({ where: { active: true }, orderBy: { name: 'asc' } });

  return (
    <div className="max-w-2xl">
      <PageHeader title="Add expense" actions={<Link href="/expenses" className="btn-secondary">← Expenses</Link>} />
      <Card>
        {categories.length === 0 ? (
          <Empty>
            No active expense categories.{' '}
            {can(user, 'expenses_manage') ? <Link href="/expenses/categories" className="link">Add one first.</Link> : 'Ask the owner to add one.'}
          </Empty>
        ) : (
          <ActionForm action={createExpense} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date *"><input type="date" name="date" defaultValue={todayManila()} max={todayManila()} required className="input" /></Field>
              <CategoryField categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
              <Field label="Amount (₱) *"><input name="amount" inputMode="decimal" required placeholder="0.00" className="input" /></Field>
              <Field label="Paid via *"><Select name="paidVia" required defaultValue="CASH" options={options(PAYMENT_METHOD)} /></Field>
              <Field label="Notes" className="sm:col-span-2"><textarea name="notes" rows={2} className="input" placeholder="e.g. Meralco bill for September" /></Field>
              <div className="sm:col-span-2"><ImageUpload name="receipt" label="Receipt photo (optional)" /></div>
            </div>
            <SubmitButton>Save expense</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
