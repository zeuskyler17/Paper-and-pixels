import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fmtQty, peso, round3 } from '@/lib/money';
import { fmtDate, fmtDateTime, isOverdue } from '@/lib/dates';
import { PO_STATUS } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, DL, Field, PageHeader, Stat, StatusBadge, TableWrap } from '@/components/ui';
import { cancelPurchaseOrder, markPOSent, receivePO, revertPOToDraft } from '../actions';
import { receivedPercent } from '../_lib';
import { SupplierPaymentForm, SupplierPaymentsTable } from '../../suppliers/SupplierPayments';
import { receivedValue } from '../../suppliers/_payables';
import { MovementsTable, movementInclude } from '../../inventory/MovementsTable';

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('purchasing');
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: Number(id) || 0 },
    include: {
      supplier: true,
      createdBy: { select: { name: true } },
      items: { orderBy: { id: 'asc' }, include: { material: { select: { id: true, name: true, unit: true, sku: true } } } },
      payments: { orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], include: { createdBy: { select: { name: true } } } },
    },
  });
  if (!po) notFound();
  const movements = await prisma.stockMovement.findMany({ where: { purchaseOrderId: po.id }, orderBy: { id: 'desc' }, include: movementInclude });

  const received = po.items.reduce((s, i) => s + receivedValue(i), 0);
  const paid = po.payments.filter((p) => !p.voided).reduce((s, p) => s + p.amount, 0);
  const pct = receivedPercent(po.items);
  const anyReceived = po.items.some((i) => i.receivedQty > 0);
  const canReceive = po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED';
  const canCancel = po.status !== 'CANCELLED' && !anyReceived;
  const late = canReceive && isOverdue(po.expectedDate);

  return (
    <div className="space-y-4">
      <PageHeader
        title={po.poNo}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <StatusBadge value={po.status} labels={PO_STATUS} />
          <Link href={`/suppliers/${po.supplier.id}`} className="link">{po.supplier.name}</Link>
        </span>}
        actions={<>
          <Link href={`/print/po/${po.id}`} className="btn-secondary">Print PO</Link>
          {po.status === 'DRAFT' && <Link href={`/purchase-orders/${po.id}/edit`} className="btn-secondary">Edit</Link>}
          {po.status === 'DRAFT' && (
            <ActionForm action={markPOSent.bind(null, po.id)}><SubmitButton>Mark as sent</SubmitButton></ActionForm>
          )}
          {po.status === 'SENT' && !anyReceived && (
            <ActionForm action={revertPOToDraft.bind(null, po.id)}><SubmitButton className="btn-secondary">Back to draft</SubmitButton></ActionForm>
          )}
        </>}
      />

      {po.status === 'CANCELLED' && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Cancelled: {po.cancelReason ?? '—'}</div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="PO total" value={peso(po.total)} />
        <Stat label="Received" value={`${pct}%`} hint={`Value ${peso(received)}`} tone={pct >= 100 ? 'green' : pct > 0 ? 'amber' : undefined} />
        <Stat label="Paid on this PO" value={peso(paid)} />
        <Stat label="Unpaid (received − paid)" value={peso(received - paid)} tone={received - paid > 0 ? 'red' : 'green'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details">
          <DL items={[
            ['Supplier', po.supplier.name],
            ['Contact', [po.supplier.contactPerson, po.supplier.mobile].filter(Boolean).join(' · ')],
            ['Terms', po.supplier.paymentTerms],
            ['Order date', fmtDate(po.orderDate)],
            ['Expected', <span key="e" className={late ? 'text-red-600' : ''}>{fmtDate(po.expectedDate)}{late && ' (late)'}</span>],
            ['Created by', `${po.createdBy.name} · ${fmtDateTime(po.createdAt)}`],
            ['Notes', po.notes],
          ]} />
        </Card>
        <Card title="Items" className="lg:col-span-2">
          <TableWrap>
            <table className="table">
              <thead><tr><th>Material</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Unit cost</th><th className="text-right">Line total</th></tr></thead>
              <tbody>
                {po.items.map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/inventory/${i.material.id}`} className="link">{i.material.name}</Link>{i.material.sku && <span className="text-xs text-slate-500"> · {i.material.sku}</span>}</td>
                    <td className="whitespace-nowrap text-right">{fmtQty(i.quantity)} {i.material.unit}</td>
                    <td className={`whitespace-nowrap text-right ${i.receivedQty >= i.quantity ? 'text-emerald-700' : i.receivedQty > 0 ? 'text-amber-700' : 'text-slate-500'}`}>{fmtQty(i.receivedQty)}</td>
                    <td className="text-right">{peso(i.unitCost)}</td>
                    <td className="text-right font-medium">{peso(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4} className="px-3 py-2 text-right font-semibold">Total</td><td className="px-3 py-2 text-right font-bold">{peso(po.total)}</td></tr></tfoot>
            </table>
          </TableWrap>
        </Card>
      </div>

      {canReceive && (
        <Card title="Receive items">
          <ActionForm action={receivePO.bind(null, po.id)} className="space-y-3" confirm="Add these quantities to stock?">
            <p className="text-sm text-slate-600">Enter the quantity that arrived now. Stock is added automatically at the PO unit cost.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {po.items.map((i) => {
                const remaining = round3(i.quantity - i.receivedQty);
                if (remaining <= 0) return null;
                return (
                  <Field key={i.id} label={i.material.name} hint={`Remaining ${fmtQty(remaining)} of ${fmtQty(i.quantity)} ${i.material.unit}`}>
                    <input name={`qty_${i.id}`} type="number" step="0.001" min="0" max={remaining} defaultValue={remaining} className="input" />
                  </Field>
                );
              })}
            </div>
            <SubmitButton>Receive into stock</SubmitButton>
          </ActionForm>
        </Card>
      )}
      {po.status === 'DRAFT' && (
        <p className="text-sm text-slate-500">Mark this PO as sent once it has been ordered from the supplier; you can then receive items against it.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Payments for this PO" className="lg:col-span-2">
          <SupplierPaymentsTable rows={po.payments} isAdmin={user.isAdmin} showPo={false} />
        </Card>
        {po.status !== 'CANCELLED' && (
          <Card title="Record payment">
            <SupplierPaymentForm supplierId={po.supplierId} poId={po.id} suggestedAmount={(anyReceived ? received : po.total) - paid} />
          </Card>
        )}
      </div>

      {movements.length > 0 && (
        <Card title="Stock received">
          <MovementsTable rows={movements} showMaterial />
        </Card>
      )}

      {canCancel && (
        <Card title="Cancel purchase order">
          <ActionForm action={cancelPurchaseOrder.bind(null, po.id)} className="flex flex-col gap-2 sm:flex-row sm:items-end" confirm="Cancel this purchase order?">
            <Field label="Reason *" className="flex-1"><input name="reason" required className="input" /></Field>
            <SubmitButton className="btn-danger">Cancel PO</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
