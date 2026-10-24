import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '@/lib/labels';
import { accountLabel } from '@/lib/paymentAccounts';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Empty, PageHeader, Stat, StatusBadge, TableWrap } from '@/components/ui';
import { removeCustomerPrice, saveCustomerPrice, setBalanceHidden, updateCustomer } from '../actions';
import { specialPriceLabel } from '@/lib/pricing';
import { CustomerFields } from '../CustomerFields';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('customers');
  const { id } = await params;
  const products = user.isAdmin ? await prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, basePrice: true } }) : [];
  const customer = await prisma.customer.findUnique({
    where: { id: Number(id) },
    include: {
      orders: { orderBy: { createdAt: 'desc' } },
      payments: { orderBy: { paidAt: 'desc' }, include: { order: { select: { orderNo: true } }, account: true } },
      specialPrices: { include: { product: { select: { name: true, basePrice: true, pricingMode: true } } }, orderBy: { product: { name: 'asc' } } },
    },
  });
  if (!customer) notFound();

  const active = customer.orders.filter((o) => o.status !== 'CANCELLED');
  const balance = active.reduce((s, o) => s + o.balance, 0);
  const totalSpent = active.reduce((s, o) => s + o.total, 0);
  const lastOrder = customer.orders[0]?.createdAt;
  // Owner/admin can hide a customer's receivable from staff; staff then see "Hidden" instead of amounts.
  const hide = customer.balanceHidden && !user.isAdmin;

  return (
    <div className="space-y-4">
      <PageHeader
        title={customer.name}
        subtitle={[customer.mobile, customer.facebook, customer.specialPrices.length ? `${customer.specialPrices.length} special discount${customer.specialPrices.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
        actions={<Link href={`/orders/new?customerId=${customer.id}`} className="btn-primary">+ New order</Link>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {hide
          ? <Stat label="Outstanding balance" value={<span className="text-lg text-slate-400">Hidden</span>} hint="Ask the owner" />
          : <Stat label="Outstanding balance" value={peso(balance)} tone={balance > 0 ? 'red' : 'green'} hint={customer.balanceHidden ? 'Hidden from staff' : undefined} />}
        <Stat label="Total orders" value={active.length} />
        <Stat label="Total billed" value={peso(totalSpent)} />
        <Stat label="Last order" value={<span className="text-lg">{fmtDate(lastOrder)}</span>} />
      </div>

      <Card title="Orders">
        {customer.orders.length === 0 ? <Empty>No orders yet.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Order no.</th><th>Date</th><th>Status</th><th>Payment</th><th className="text-right">Total</th>{!hide && <th className="text-right">Balance</th>}</tr></thead>
              <tbody>
                {customer.orders.map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/orders/${o.id}`} className="link">{o.orderNo}</Link></td>
                    <td>{fmtDate(o.createdAt)}</td>
                    <td><StatusBadge value={o.status} labels={ORDER_STATUS} /></td>
                    <td>{hide ? <span className="text-slate-400">—</span> : <StatusBadge value={o.paymentStatus} labels={PAYMENT_STATUS} />}</td>
                    <td className="text-right">{peso(o.total)}</td>
                    {!hide && <td className={`text-right font-medium ${o.balance > 0 ? 'text-red-600' : ''}`}>{peso(o.balance)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="Payments">
        {customer.payments.length === 0 ? <Empty>No payments yet.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Receipt no.</th><th>Date</th><th>Order</th><th>Method</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {customer.payments.map((p) => (
                  <tr key={p.id} className={p.voided ? 'text-slate-400 line-through' : ''}>
                    <td>{p.receiptNo}</td>
                    <td>{fmtDateTime(p.paidAt)}</td>
                    <td><Link href={`/orders/${p.orderId}`} className="link">{p.order.orderNo}</Link></td>
                    <td>{PAYMENT_METHOD[p.method]}{p.reference ? ` · ${p.reference}` : ''}{p.account && <div className="text-[11.5px] text-slate-500">to {accountLabel(p.account)}</div>}</td>
                    <td className="text-right">{peso(p.amount)}{p.voided && ' (void)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {!customer.isInternal && (user.isAdmin || customer.specialPrices.length > 0) && (
        <Card title="Special discounts">
          {customer.specialPrices.length === 0 ? <p className="text-sm text-slate-600">No special discounts yet. Deduct an amount from each item of chosen products for this customer (suki, school, reseller…). New orders deduct it automatically — no price-change reason or approval needed at the counter.</p> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Product</th><th className="text-right">Normal price</th><th className="text-right">Less per item</th>{user.isAdmin && <th />}</tr></thead>
                <tbody>
                  {customer.specialPrices.map((sp) => (
                    <tr key={sp.id}>
                      <td>{sp.product.name}</td>
                      <td className="text-right text-slate-500">{sp.product.basePrice > 0 ? `${peso(sp.product.basePrice)}${sp.product.pricingMode === 'PER_SQFT' ? ' / sq ft' : ''}` : 'depends on options'}</td>
                      <td className="text-right font-semibold text-emerald-700">− {specialPriceLabel(sp, peso)}{sp.product.basePrice > 0 ? <div className="text-[11px] font-normal text-slate-500">pays {peso(Math.max(0, sp.product.basePrice - sp.amountOff))}{sp.product.pricingMode === 'PER_SQFT' ? ' / sq ft' : ''}</div> : null}</td>
                      {user.isAdmin && <td className="text-right"><ActionForm action={removeCustomerPrice.bind(null, sp.id)} confirm={`Remove the special discount on ${sp.product.name}?`}><SubmitButton className="btn-secondary btn-sm">Remove</SubmitButton></ActionForm></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {user.isAdmin && (
            <ActionForm action={saveCustomerPrice.bind(null, customer.id)} resetOnSuccess className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <label className="block min-w-[14rem] flex-1"><span className="label">Product</span>
                <select name="productId" required className="input" defaultValue="">
                  <option value="" disabled>— choose product —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.basePrice > 0 ? ` — ${peso(p.basePrice)}` : ''}</option>)}
                </select>
              </label>
              <label className="block"><span className="label">Less per item (₱)</span>
                <input name="value" inputMode="decimal" required placeholder="e.g. 3" className="input w-28 num" />
              </label>
              <SubmitButton>Save special discount</SubmitButton>
              <p className="w-full text-xs text-slate-500">This amount is deducted from each item&apos;s normal price (with its options and add-ons), e.g. ₱15 brochure − ₱3 = ₱12 each. Saving a product again changes the amount.</p>
            </ActionForm>
          )}
        </Card>
      )}

      {user.isAdmin && (
        <Card title="Balance visibility">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {customer.balanceHidden
                ? <><b>Hidden from staff.</b> Cashier / staff logins don’t see this customer’s balance on the customer list, this page, the dashboard or reports. Only owners / admins do.</>
                : <>Staff can see this customer’s balance. Hide it to keep this receivable visible to owners / admins only.</>}
            </p>
            <ActionForm action={setBalanceHidden.bind(null, customer.id, !customer.balanceHidden)}>
              <SubmitButton className={customer.balanceHidden ? 'btn-secondary' : 'btn-primary'}>{customer.balanceHidden ? 'Show balance to staff' : 'Hide balance from staff'}</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      )}

      <Card title="Customer details">
        <ActionForm action={updateCustomer.bind(null, customer.id)} className="space-y-4">
          <CustomerFields c={customer} />
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
