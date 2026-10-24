import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser, can } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, fmtDateTime, isOverdue, toDateInput } from '@/lib/dates';
import {
  DELIVERY_METHOD, DELIVERY_STATUS, FILE_SOURCE, JOB_STATUS, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, PAYMENT_TERMS, options,
} from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Card, DL, Empty, Field, PageHeader, Select, StatusBadge, TableWrap } from '@/components/ui';
import { addPayment, cancelOrder, markDelivered, setOrderStatus, updateOrderHeader, voidPayment } from '../actions';
import { DiscountFields } from './DiscountFields';
import { getPointsConfig } from '@/lib/points';
import { PaymentMethodFields } from '@/components/PaymentMethodFields';
import { accountLabel } from '@/lib/paymentAccounts';
import { groupSpecs } from '@/lib/pricing';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('orders');
  const admin = can(user, 'orders_override'); // may release with an unpaid balance
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id: Number(id) || 0 },
    include: {
      customer: true,
      createdBy: { select: { name: true } },
      discountApprovedBy: { select: { name: true } },
      items: { orderBy: { id: 'asc' }, include: { specs: { orderBy: { id: 'asc' } }, job: { include: { assignedTo: { select: { name: true } } } } } },
      payments: { orderBy: { paidAt: 'asc' }, include: { receivedBy: { select: { name: true } }, voidedBy: { select: { name: true } }, voidApprovedBy: { select: { name: true } }, account: true } },
      deliveries: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!order) notFound();
  const pointsOn = (await getPointsConfig()).enabled;
  const accounts = await prisma.paymentAccount.findMany({
    where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: { id: true, method: true, label: true, accountNumber: true },
  });

  const cancelled = order.status === 'CANCELLED';
  const delivered = order.status === 'DELIVERED';
  const open = !cancelled && !delivered;
  const overdue = (order.status === 'PENDING' || order.status === 'IN_PRODUCTION') && isOverdue(order.targetDate);
  const jobs = order.items.filter((i) => i.job).map((i) => ({ ...i.job!, item: i }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Order ${order.orderNo}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/customers/${order.customer.id}`} className="link">{order.customer.name}</Link>
            <StatusBadge value={order.status} labels={ORDER_STATUS} />
            {order.customer.isInternal ? <Badge tone="amber">Branch transfer · no charge</Badge> : <StatusBadge value={order.paymentStatus} labels={PAYMENT_STATUS} />}
            {overdue && <span className="text-xs font-semibold text-red-600">Overdue</span>}
          </span>
        }
        actions={
          <>
            <Link href={`/print/order/${order.id}`} className="btn-secondary">Print order slip</Link>
            {!cancelled && <Link href={`/deliveries/new?orderId=${order.id}`} className="btn-secondary">+ Delivery</Link>}
          </>
        }
      />

      {cancelled && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Cancelled {fmtDateTime(order.cancelledAt)} — {order.cancelReason}
          {order.amountPaid > 0 && ` · ${peso(order.amountPaid)} in payments still recorded: void or refund them separately.`}
        </p>
      )}
      {delivered && order.deliveredOverride && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Released with an unpaid balance (admin override).</p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Order details" className="lg:col-span-2">
          <DL items={[
            ['Customer', <span key="c">{order.customer.name}{order.customer.mobile ? ` · ${order.customer.mobile}` : ''}{order.customer.facebook ? ` · ${order.customer.facebook}` : ''}</span>],
            ['Order date', fmtDateTime(order.createdAt)],
            ['Created by', order.createdBy.name],
            ['Target date', <span key="t" className={overdue ? 'text-red-600' : ''}>{fmtDate(order.targetDate)}</span>],
            ['Payment terms', PAYMENT_TERMS[order.paymentTerms]],
            ['Delivered / picked up', order.deliveredAt ? fmtDateTime(order.deliveredAt) : '—'],
            ['Notes', order.notes],
          ]} />
        </Card>
        <Card title="Totals">
          <dl className="space-y-1 text-sm">
            <Row k="Subtotal" v={peso(order.subtotal)} />
            {order.discount > 0 && <Row k={`Discount${order.discountReason ? ` (${order.discountReason})` : ''}`} v={`−${peso(order.discount)}`} />}
            {order.discount > 0 && <p className="-mt-1 text-right text-xs text-slate-500">{order.discountApprovedBy ? `approved by ${order.discountApprovedBy.name}` : 'no approval recorded'}</p>}
            {order.pointsAmount > 0 && <Row k={`Points used (${order.pointsUsed})`} v={`−${peso(order.pointsAmount)}`} />}
            {pointsOn && !order.earnsPoints && <p className="text-right text-[11px] text-slate-500">Special customer discount — this order earns no points.</p>}
            <Row k="Total" v={peso(order.total)} bold />
            <Row k="Paid" v={peso(order.amountPaid)} />
            <Row k="Balance" v={peso(order.balance)} bold tone={order.balance > 0 ? 'text-red-600' : 'text-emerald-600'} />
          </dl>
        </Card>
      </div>

      <Card title="Items">
        <TableWrap>
          <table className="table">
            <thead><tr><th>Item</th><th>Specifications</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Line total</th></tr></thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td className="min-w-[10rem]">
                    <div className="font-medium">{it.description}</div>
                    {it.widthFt != null && it.heightFt != null && <div className="text-xs text-slate-500">{it.widthFt} × {it.heightFt} ft</div>}
                    {it.fileSource !== 'NONE' && <div className="text-xs text-slate-500">Files: {FILE_SOURCE[it.fileSource]}{it.fileSourceNote ? ` — ${it.fileSourceNote}` : ''}</div>}
                  </td>
                  <td className="min-w-[12rem] text-xs">
                    {groupSpecs(it.specs).map(([n, v]) => <div key={n}><span className="text-slate-500">{n}:</span> {v}</div>)}
                    {it.specsNotes && <div className="mt-1 whitespace-pre-line text-slate-700">{it.specsNotes}</div>}
                    {it.specs.length === 0 && !it.specsNotes && '—'}
                  </td>
                  <td className="text-right">{it.quantity}</td>
                  <td className="text-right whitespace-nowrap">
                    {peso(it.unitPrice)}
                    {it.priceOverrideReason && (
                      <div className="text-xs text-amber-700" title={it.priceOverrideReason}>was {peso(it.suggestedUnitPrice)} · {it.priceOverrideReason}</div>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap font-medium">{peso(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Production jobs">
          {jobs.length === 0 ? <Empty>No production jobs for this order. Use “Set status” below to track progress.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <Link href={`/jobs/${j.id}`} className="link">Job #{j.id}</Link> · {j.item.description}
                    <div className="text-xs text-slate-500">{j.assignedTo ? `Assigned to ${j.assignedTo.name}` : 'Not assigned'} · due {fmtDate(j.dueDate)}</div>
                  </div>
                  <StatusBadge value={j.status} labels={JOB_STATUS} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Deliveries" actions={!cancelled ? <Link href={`/deliveries/new?orderId=${order.id}`} className="btn-secondary btn-sm">+ New</Link> : undefined}>
          {order.deliveries.length === 0 ? <Empty>No deliveries scheduled.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {order.deliveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <Link href={`/deliveries/${d.id}`} className="link">{DELIVERY_METHOD[d.method]}</Link>
                    <div className="text-xs text-slate-500">
                      {d.scheduledDate ? `Scheduled ${fmtDate(d.scheduledDate)}` : 'Not scheduled'}
                      {d.trackingNo ? ` · ${d.trackingNo}` : ''}{d.recipient ? ` · ${d.recipient}` : ''}
                    </div>
                  </div>
                  <StatusBadge value={d.status} labels={DELIVERY_STATUS} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Payments">
        {order.payments.length === 0 ? <Empty>No payments yet.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Receipt no.</th><th>Date</th><th>Method</th><th>Received by</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>
                {order.payments.map((p) => (
                  <tr key={p.id}>
                    <td className={p.voided ? 'text-slate-400 line-through' : ''}>{p.receiptNo}</td>
                    <td className={`whitespace-nowrap ${p.voided ? 'text-slate-400 line-through' : ''}`}>{fmtDateTime(p.paidAt)}</td>
                    <td className={p.voided ? 'text-slate-400 line-through' : ''}>{PAYMENT_METHOD[p.method]}{p.reference ? ` · ${p.reference}` : ''}{p.account && <div className="text-[11.5px] text-slate-500">to {accountLabel(p.account)}</div>}</td>
                    <td>{p.receivedBy.name}</td>
                    <td className={`text-right whitespace-nowrap ${p.voided ? 'text-slate-400 line-through' : 'font-medium'}`}>{peso(p.amount)}</td>
                    <td className="min-w-[10rem] text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link href={`/print/receipt/${p.id}`} className="link text-xs">Receipt</Link>
                        {!p.voided && (
                          <details className="text-left">
                            <summary className="cursor-pointer text-xs font-medium text-red-700">Void</summary>
                            <ActionForm action={voidPayment.bind(null, p.id)} confirm={`Void receipt ${p.receiptNo} (${peso(p.amount)})?`} className="mt-1 flex w-56 flex-col gap-1">
                              <input name="reason" className="input" placeholder="Reason *" required />
                              <input name="approvalPin" type="password" inputMode="numeric" pattern="\d{4,8}" maxLength={8} autoComplete="off" className="input" placeholder="Owner approval PIN *" required />
                              <SubmitButton className="btn-danger btn-sm">Void payment</SubmitButton>
                            </ActionForm>
                          </details>
                        )}
                      </div>
                      {p.voided && (
                        <div className="text-left text-xs text-red-700">
                          VOID {fmtDateTime(p.voidedAt)}{p.voidedBy ? ` by ${p.voidedBy.name}` : ''}{p.voidApprovedBy ? ` · approved by ${p.voidApprovedBy.name}` : ''} — {p.voidReason}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {!cancelled && order.balance > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="mb-2 text-sm font-semibold">Add payment</h3>
            <ActionForm action={addPayment.bind(null, order.id)} resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Amount (₱) *"><input name="amount" className="input" inputMode="decimal" placeholder={(order.balance / 100).toFixed(2)} required /></Field>
                <PaymentMethodFields accounts={accounts} />
                <Field label="Reference no."><input name="reference" className="input" placeholder="GCash / bank ref" /></Field>
                <Field label="Notes"><input name="notes" className="input" /></Field>
              </div>
              <div className="mt-3"><SubmitButton>Record payment</SubmitButton></div>
            </ActionForm>
          </div>
        )}
      </Card>

      {!cancelled && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Edit order">
            <ActionForm action={updateOrderHeader.bind(null, order.id)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Target date"><input type="date" name="targetDate" defaultValue={toDateInput(order.targetDate)} className="input" /></Field>
                <Field label="Payment terms"><Select name="paymentTerms" defaultValue={order.paymentTerms} options={options(PAYMENT_TERMS)} /></Field>
                <DiscountFields subtotal={order.subtotal} discount={order.discount} reason={order.discountReason} approvedBy={order.discountApprovedBy?.name} />
                <Field label="Notes" className="sm:col-span-2"><textarea name="notes" defaultValue={order.notes ?? ''} rows={2} className="input" /></Field>
              </div>
              <p className="mt-2 text-xs text-slate-500">Total = subtotal {peso(order.subtotal)} − discount{order.pointsAmount > 0 ? ` − points ${peso(order.pointsAmount)}` : ''}. Changing the target date also moves the due date of unfinished jobs.</p>
              <div className="mt-3"><SubmitButton>Save changes</SubmitButton></div>
            </ActionForm>
          </Card>

          <div className="space-y-4">
            {open && (
              <Card title="Status">
                <ActionForm action={setOrderStatus.bind(null, order.id)}>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Set status" className="flex-1">
                      <select name="status" defaultValue={order.status} className="input">
                        <option value="PENDING">{ORDER_STATUS.PENDING}</option>
                        <option value="IN_PRODUCTION">{ORDER_STATUS.IN_PRODUCTION}</option>
                        <option value="COMPLETED">{ORDER_STATUS.COMPLETED}</option>
                      </select>
                    </Field>
                    <SubmitButton className="btn-secondary">Update</SubmitButton>
                  </div>
                  {jobs.length > 0 && <p className="mt-2 text-xs text-slate-500">Status also updates automatically as production jobs move.</p>}
                </ActionForm>

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <ActionForm action={markDelivered.bind(null, order.id)} confirm="Mark this order as Delivered / Picked up?">
                    {order.balance > 0 && !admin ? (
                      <p className="text-sm text-amber-800">Balance of {peso(order.balance)} must be paid before release. Ask the admin to override.</p>
                    ) : (
                      <div className="space-y-2">
                        {order.balance > 0 && (
                          <Field label="Override reason (unpaid balance) *" hint={`Balance ${peso(order.balance)} — release anyway as admin.`}>
                            <input name="overrideReason" className="input" required />
                          </Field>
                        )}
                        <SubmitButton>Mark Delivered / Picked up</SubmitButton>
                      </div>
                    )}
                  </ActionForm>
                </div>
              </Card>
            )}

            {!delivered && (
              <Card title="Cancel order">
                <ActionForm action={cancelOrder.bind(null, order.id)} confirm={`Cancel order ${order.orderNo}? Unfinished jobs will be cancelled too.`}>
                  <Field label="Reason *"><input name="reason" className="input" required /></Field>
                  <p className="mt-2 text-xs text-slate-500">Payments are kept. Void them or refund the customer separately.</p>
                  <div className="mt-3"><SubmitButton className="btn-danger">Cancel order</SubmitButton></div>
                </ActionForm>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, bold, tone = '' }: { k: string; v: string; bold?: boolean; tone?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{k}</dt>
      <dd className={`${bold ? 'font-semibold' : ''} ${tone}`}>{v}</dd>
    </div>
  );
}
