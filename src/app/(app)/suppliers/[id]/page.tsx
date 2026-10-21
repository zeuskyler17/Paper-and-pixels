import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fmtQty, peso } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { MATERIAL_LEVEL, PO_STATUS } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Card, Empty, PageHeader, Stat, StatusBadge, TableWrap } from '@/components/ui';
import { updateSupplier } from '../actions';
import { SupplierFields } from '../SupplierFields';
import { SupplierPaymentForm, SupplierPaymentsTable } from '../SupplierPayments';
import { PAYABLE_FORMULA, receivedValue, supplierPayable } from '../_payables';

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('purchasing');
  const { id } = await params;
  const supplier = await prisma.supplier.findUnique({
    where: { id: Number(id) || 0 },
    include: {
      purchaseOrders: { orderBy: { id: 'desc' }, include: { items: { select: { quantity: true, receivedQty: true, unitCost: true } } } },
      payments: { orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], include: { createdBy: { select: { name: true } }, purchaseOrder: { select: { id: true, poNo: true } } } },
      materials: { where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, level: true, unit: true, stock: true, reorderLevel: true } },
    },
  });
  if (!supplier) notFound();
  const payable = await supplierPayable(supplier.id);
  const openPos = supplier.purchaseOrders.filter((p) => p.status !== 'CANCELLED').map((p) => ({ id: p.id, poNo: p.poNo }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={supplier.name}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          {[supplier.contactPerson, supplier.mobile, supplier.paymentTerms && `Terms: ${supplier.paymentTerms}`].filter(Boolean).join(' · ')}
          {!supplier.active && <Badge>Inactive</Badge>}
        </span>}
        actions={<Link href={`/purchase-orders/new?supplierId=${supplier.id}`} className="btn-primary">+ New PO</Link>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Payable balance" value={peso(payable.balance)} tone={payable.balance > 0 ? 'red' : 'green'} hint={payable.balance < 0 ? 'Advance / overpayment' : undefined} />
        <Stat label="Goods received" value={peso(payable.received)} />
        <Stat label="Total paid" value={peso(payable.paid)} />
        <Stat label="Purchase orders" value={supplier.purchaseOrders.length} />
      </div>
      <p className="-mt-2 text-xs text-slate-500">{PAYABLE_FORMULA}</p>

      <Card title="Purchase orders">
        {supplier.purchaseOrders.length === 0 ? <Empty>No purchase orders yet.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>PO no.</th><th>Order date</th><th>Expected</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Received value</th></tr></thead>
              <tbody>
                {supplier.purchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td><Link href={`/purchase-orders/${po.id}`} className="link">{po.poNo}</Link></td>
                    <td>{fmtDate(po.orderDate)}</td>
                    <td>{fmtDate(po.expectedDate)}</td>
                    <td><StatusBadge value={po.status} labels={PO_STATUS} /></td>
                    <td className="text-right">{peso(po.total)}</td>
                    <td className="text-right">{po.status === 'CANCELLED' ? '—' : peso(po.items.reduce((s, i) => s + receivedValue(i), 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Payments" className="lg:col-span-2">
          <SupplierPaymentsTable rows={supplier.payments} isAdmin={user.isAdmin} />
        </Card>
        <Card title="Record payment">
          <SupplierPaymentForm supplierId={supplier.id} pos={openPos} />
        </Card>
      </div>

      {supplier.materials.length > 0 && (
        <Card title="Materials from this supplier">
          <TableWrap>
            <table className="table">
              <thead><tr><th>Material</th><th>Level</th><th className="text-right">Stock</th></tr></thead>
              <tbody>
                {supplier.materials.map((m) => (
                  <tr key={m.id} className={m.stock <= m.reorderLevel ? 'bg-red-50' : ''}>
                    <td><Link href={`/inventory/${m.id}`} className="link">{m.name}</Link></td>
                    <td>{MATERIAL_LEVEL[m.level]}</td>
                    <td className={`text-right ${m.stock <= m.reorderLevel ? 'font-semibold text-red-600' : ''}`}>{fmtQty(m.stock)} {m.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <Card title="Supplier details">
        <ActionForm action={updateSupplier.bind(null, supplier.id)} className="space-y-4">
          <SupplierFields s={supplier} />
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
