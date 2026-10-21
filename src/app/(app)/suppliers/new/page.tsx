import { requireUser } from '@/lib/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, PageHeader } from '@/components/ui';
import { createSupplier } from '../actions';
import { SupplierFields } from '../SupplierFields';

export const metadata = { title: 'New supplier' };

export default async function NewSupplierPage() {
  await requireUser('purchasing');
  return (
    <div className="max-w-2xl">
      <PageHeader title="New supplier" />
      <Card>
        <ActionForm action={createSupplier} className="space-y-4">
          <SupplierFields />
          <SubmitButton>Save supplier</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
