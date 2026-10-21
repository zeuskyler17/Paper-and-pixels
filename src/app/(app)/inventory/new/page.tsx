import { prisma } from '@/lib/db';
import { requireUser, getBranch } from '@/lib/auth';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, PageHeader } from '@/components/ui';
import { createMaterial } from '../actions';
import { MaterialFields } from '../MaterialFields';
import { levelsFor } from '@/lib/branches';

export const metadata = { title: 'New material' };

export default async function NewMaterialPage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  await requireUser('inventory');
  const simple = !!getBranch()?.simpleInventory;
  const { level } = await searchParams;
  const suppliers = await prisma.supplier.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return (
    <div className="max-w-2xl">
      <PageHeader title="New material" />
      <Card>
        <ActionForm action={createMaterial} className="space-y-4">
          <MaterialFields suppliers={suppliers} isNew simple={simple} m={{ level: level && levelsFor(simple).includes(level) ? level : undefined }} />
          <SubmitButton>Save material</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
