import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { toDateInput } from '@/lib/dates';
import { Card, PageHeader } from '@/components/ui';
import { POForm } from '../../POForm';
import { poFormOptions } from '../../_lib';

export const metadata = { title: 'Edit purchase order' };

export default async function EditPOPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('purchasing');
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({ where: { id: Number(id) || 0 }, include: { items: { orderBy: { id: 'asc' } } } });
  if (!po) notFound();
  if (po.status !== 'DRAFT') redirect(`/purchase-orders/${po.id}`);
  const { suppliers, materials } = await poFormOptions({ supplierId: po.supplierId, materialIds: po.items.map((i) => i.materialId) });
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${po.poNo}`} actions={<Link href={`/purchase-orders/${po.id}`} className="btn-secondary">Cancel editing</Link>} />
      <Card>
        <POForm poId={po.id} suppliers={suppliers} materials={materials}
          initial={{
            supplierId: po.supplierId, orderDate: toDateInput(po.orderDate), expectedDate: toDateInput(po.expectedDate), notes: po.notes ?? '',
            items: po.items.map((i) => ({ materialId: i.materialId, quantity: i.quantity, unitCost: i.unitCost })),
          }} />
      </Card>
    </div>
  );
}
