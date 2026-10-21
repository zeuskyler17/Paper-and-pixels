import { requireUser } from '@/lib/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, PageHeader } from '@/components/ui';
import { createCustomer } from '../actions';
import { CustomerFields } from '../CustomerFields';

export const metadata = { title: 'New customer' };

export default async function NewCustomerPage() {
  await requireUser('customers');
  return (
    <div className="max-w-2xl">
      <PageHeader title="New customer" />
      <Card>
        <ActionForm action={createCustomer} className="space-y-4">
          <CustomerFields />
          <SubmitButton>Save customer</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
