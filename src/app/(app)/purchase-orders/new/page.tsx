import { requireUser } from '@/lib/auth';
import { todayManila } from '@/lib/dates';
import { Card, PageHeader } from '@/components/ui';
import { POForm } from '../POForm';
import { poFormOptions } from '../_lib';

export const metadata = { title: 'New purchase order' };

export default async function NewPOPage({ searchParams }: { searchParams: Promise<{ supplierId?: string }> }) {
  await requireUser('purchasing');
  const { supplierId } = await searchParams;
  const { suppliers, materials } = await poFormOptions();
  const sid = suppliers.some((s) => s.id === Number(supplierId)) ? Number(supplierId) : null;
  return (
    <div className="max-w-4xl">
      <PageHeader title="New purchase order" subtitle="Saved as a draft. Mark it as sent once you've ordered from the supplier." />
      <Card>
        <POForm suppliers={suppliers} materials={materials}
          initial={{ supplierId: sid, orderDate: todayManila(), expectedDate: '', notes: '', items: [] }} />
      </Card>
    </div>
  );
}
