import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser, can } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { DELIVERY_METHOD, DELIVERY_STATUS, ORDER_STATUS } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, DL, PageHeader, StatusBadge } from '@/components/ui';
import { changeDeliveryStatus, updateDelivery } from '../actions';
import { DeliveryFields } from '../DeliveryFields';
import { NEXT_STATUSES } from '../_lib';

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('deliveries');
  const { id } = await params;
  const deliveryId = Number(id);
  if (!Number.isInteger(deliveryId)) notFound();

  const d = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      createdBy: { select: { name: true } },
      order: { select: { id: true, orderNo: true, status: true, balance: true, total: true, customer: { select: { name: true, mobile: true } } } },
    },
  });
  if (!d) notFound();

  const next = NEXT_STATUSES[d.status];
  const editable = d.status === 'SCHEDULED' || d.status === 'IN_TRANSIT';
  const hasBalance = d.order.balance > 0;
  const isAdmin = can(user, 'orders_override'); // may release with an unpaid balance

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        title={`${DELIVERY_METHOD[d.method]} · ${d.order.orderNo}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge value={d.status} labels={DELIVERY_STATUS} /> Created {fmtDateTime(d.createdAt)} by {d.createdBy.name}</span>}
        actions={
          <>
            <Link href={`/print/delivery/${d.id}`} className="btn-secondary">Print slip</Link>
            <Link href="/deliveries" className="btn-secondary">← Deliveries</Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Summary">
          <DL items={[
            ['Order no.', <Link key="o" href={`/orders/${d.order.id}`} className="link">{d.order.orderNo}</Link>],
            ['Customer', [d.order.customer.name, d.order.customer.mobile].filter(Boolean).join(' · ')],
            ['Order status', <StatusBadge key="os" value={d.order.status} labels={ORDER_STATUS} />],
            ['Balance', <span key="b" className={hasBalance ? 'font-semibold text-red-600' : ''}>{peso(d.order.balance)}</span>],
            ['Recipient', [d.recipient, d.contactNo].filter(Boolean).join(' · ')],
            ['Address', d.address],
            ['Rider / tracking', [d.rider, d.trackingNo].filter(Boolean).join(' · ')],
            ['Fee', d.fee ? peso(d.fee) : null],
            ['Scheduled', fmtDate(d.scheduledDate)],
            ['Delivered at', fmtDateTime(d.deliveredAt)],
            ['Notes', d.notes ? <span key="n" className="whitespace-pre-wrap">{d.notes}</span> : null],
          ]} />
        </Card>

        <Card title="Status">
          {next.length === 0 ? (
            <p className="text-sm text-slate-600">This record is {DELIVERY_STATUS[d.status].toLowerCase()}. No further changes.</p>
          ) : (
            <div className="space-y-4">
              {next.filter((s) => s !== 'CANCELLED').map((s) => (
                <ActionForm key={s} action={changeDeliveryStatus.bind(null, d.id)} className="space-y-2"
                  confirm={s === 'DELIVERED' ? `Mark ${d.order.orderNo} as delivered / picked up?` : undefined}>
                  <input type="hidden" name="to" value={s} />
                  {s === 'DELIVERED' && hasBalance && (
                    isAdmin ? (
                      <label className="block">
                        <span className="label">Override reason (balance {peso(d.order.balance)})</span>
                        <input name="overrideReason" className="input" placeholder="Why release with an unpaid balance?" />
                      </label>
                    ) : (
                      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        This order still has a balance of {peso(d.order.balance)}. Collect payment first, or ask the admin to override.
                      </p>
                    )
                  )}
                  <SubmitButton className={s === 'DELIVERED' ? 'btn-primary' : 'btn-secondary'}>
                    {s === 'DELIVERED' ? (d.method === 'PICKUP' ? 'Mark picked up / delivered' : 'Mark delivered') : `Mark ${DELIVERY_STATUS[s].toLowerCase()}`}
                  </SubmitButton>
                </ActionForm>
              ))}
              {next.includes('CANCELLED') && (
                <ActionForm action={changeDeliveryStatus.bind(null, d.id)} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4" confirm="Cancel this delivery?">
                  <input type="hidden" name="to" value="CANCELLED" />
                  <label className="block min-w-[12rem] flex-1">
                    <span className="label">Cancel reason</span>
                    <input name="reason" required className="input" />
                  </label>
                  <SubmitButton className="btn-danger">Cancel delivery</SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
        </Card>
      </div>

      {editable && (
        <Card title="Edit details">
          <ActionForm action={updateDelivery.bind(null, d.id)} className="space-y-4">
            <DeliveryFields d={d} />
            <SubmitButton>Save changes</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
