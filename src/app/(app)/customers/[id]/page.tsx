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
import { addDeposit, payCombined, removeCustomerPrice, saveCustomerPrices, setBalanceHidden, setCombineBalances, updateCustomer, voidCombined, voidDeposit } from '../actions';
import { CombinedPayFields } from '../CombinedPayFields';
import { PaymentMethodFields } from '@/components/PaymentMethodFields';
import { SpecialPriceRows, type SpecialProduct } from '../SpecialPriceRows';
import { specialPriceLabel } from '@/lib/pricing';
import { CustomerFields } from '../CustomerFields';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('customers');
  const { id } = await params;
  const products: SpecialProduct[] = user.isAdmin
    ? (await prisma.product.findMany({
      where: { active: true }, orderBy: [{ category: { sortOrder: 'asc' } }, { category: { name: 'asc' } }, { name: 'asc' }],
      select: { id: true, name: true, basePrice: true, category: { select: { name: true } }, options: { where: { type: 'SELECT', name: { contains: 'leav', mode: 'insensitive' } }, take: 1, select: { values: { where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, label: true, priceDelta: true } } } } },
    })).map((p) => ({ id: p.id, name: p.name, basePrice: p.basePrice, category: p.category.name, leaves: p.options[0]?.values ?? [] }))
    : [];
  const customer = await prisma.customer.findUnique({
    where: { id: Number(id) },
    include: {
      orders: { orderBy: { createdAt: 'desc' } },
      payments: { orderBy: { paidAt: 'desc' }, include: { order: { select: { orderNo: true } }, account: true, depositUses: { include: { deposit: { select: { receiptNo: true } } } }, combinedPayment: { select: { id: true, receiptNo: true, amount: true } } } },
      combinedPayments: { orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], take: 30, include: { account: true, receivedBy: { select: { name: true } }, payments: { orderBy: { id: 'asc' }, select: { id: true, receiptNo: true, amount: true, voided: true, order: { select: { id: true, orderNo: true } } } } } },
      deposits: { orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], include: { account: true, receivedBy: { select: { name: true } }, uses: { orderBy: { id: 'asc' }, include: { payment: { select: { receiptNo: true, voided: true, order: { select: { id: true, orderNo: true } } } } } } } },
      specialPrices: { include: { product: { select: { name: true, basePrice: true, pricingMode: true } }, optionValue: { select: { label: true, priceDelta: true, option: { select: { name: true } } } } }, orderBy: [{ product: { name: 'asc' } }, { optionValueId: 'asc' }] },
    },
  });
  if (!customer) notFound();
  const accounts = await prisma.paymentAccount.findMany({
    where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: { id: true, method: true, label: true, accountNumber: true },
  });
  // Advance payments: each receipt's unused part; the customer's balance is their sum.
  const deposits = customer.deposits.map((d) => {
    const live = d.uses.filter((u) => !u.payment.voided);
    const used = live.reduce((s, u) => s + u.amount, 0);
    return { ...d, live, used, remaining: d.voided ? 0 : d.amount - used };
  });
  const advance = deposits.reduce((s, d) => s + d.remaining, 0);

  const active = customer.orders.filter((o) => o.status !== 'CANCELLED');
  const balance = active.reduce((s, o) => s + o.balance, 0);
  const totalSpent = active.reduce((s, o) => s + o.total, 0);
  const lastOrder = customer.orders[0]?.createdAt;
  // Owner/admin can hide a customer's receivable from staff; staff then see "Hidden" instead of amounts.
  const hide = customer.balanceHidden && !user.isAdmin;
  // Combined balance: unpaid orders oldest first (the order a combined payment is split in).
  const openOrders = active.filter((o) => o.balance > 0).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  const combined = customer.combineBalances && !customer.isInternal;

  return (
    <div className="space-y-4">
      <PageHeader
        title={customer.name}
        subtitle={[customer.mobile, customer.facebook, customer.specialPrices.length ? `${customer.specialPrices.length} special discount${customer.specialPrices.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
        actions={<Link href={`/orders/new?customerId=${customer.id}`} className="btn-primary">+ New order</Link>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {hide
          ? <Stat label="Outstanding balance" value={<span className="text-lg text-slate-400">Hidden</span>} hint="Ask the owner" />
          : <Stat label={combined ? 'Combined balance' : 'Outstanding balance'} value={peso(balance)} tone={balance > 0 ? 'red' : 'green'}
              hint={[combined ? `${openOrders.length} unpaid order${openOrders.length === 1 ? '' : 's'} · one total` : null, customer.balanceHidden ? 'Hidden from staff' : null].filter(Boolean).join(' · ') || undefined} />}
        <Stat label="Advance payment" value={peso(advance)} tone={advance > 0 ? 'green' : undefined} hint={advance > 0 ? 'Usable on the next order' : 'None on account'} />
        <Stat label="Total orders" value={active.length} />
        <Stat label="Total billed" value={peso(totalSpent)} />
        <Stat label="Last order" value={<span className="text-lg">{fmtDate(lastOrder)}</span>} />
      </div>

      {!customer.isInternal && !hide && (
        <section id="combined" className="scroll-mt-20">
        <Card
          title="Combined balance"
          actions={
            <ActionForm action={setCombineBalances.bind(null, customer.id, !customer.combineBalances)}
              confirm={customer.combineBalances ? 'Show this customer\'s balances per order again? Past combined payments stay as they are.' : undefined}>
              <SubmitButton className={customer.combineBalances ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}>{customer.combineBalances ? 'Turn off' : 'Combine balances'}</SubmitButton>
            </ActionForm>
          }
        >
          {!customer.combineBalances ? (
            <p className="text-sm text-slate-600">
              Combine this customer&apos;s unpaid orders into <b>one total balance</b>. A payment or downpayment can then be received against the total: it is split over the orders automatically, oldest first, and each order keeps its own items, total and payment history.
              {openOrders.length > 1 && <> Right now {openOrders.length} orders owe <b className="text-red-600">{peso(balance)}</b> together.</>}
            </p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="label mb-0.5">Combined balance</div>
                  <div className={`font-mono text-[26px] font-semibold leading-none tabular-nums ${balance > 0 ? 'text-red-600' : 'text-emerald-700'}`}>{peso(balance)}</div>
                  <div className="mt-1 text-[12px] text-slate-500">{openOrders.length ? `${openOrders.length} unpaid order${openOrders.length === 1 ? '' : 's'}, oldest ${fmtDate(openOrders[0].createdAt)}` : 'All orders are paid.'}</div>
                </div>
                {customer.combinedPayments.length > 0 && <div className="text-right text-[12px] text-slate-500">Last combined payment<br /><span className="font-semibold text-slate-700">{customer.combinedPayments[0].receiptNo} · {peso(customer.combinedPayments[0].amount)}</span> on {fmtDate(customer.combinedPayments[0].paidAt)}</div>}
              </div>

              {openOrders.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Receive a payment toward the combined balance</h3>
                  <ActionForm action={payCombined.bind(null, customer.id)} resetOnSuccess
                    confirm="Record this payment and split it over the ticked orders?">
                    <div className="space-y-3">
                      <CombinedPayFields orders={openOrders.map((o) => ({ id: o.id, orderNo: o.orderNo, date: fmtDate(o.createdAt), total: o.total, balance: o.balance }))} />
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <PaymentMethodFields accounts={accounts} />
                        <label className="block"><span className="label">Reference no.</span><input name="reference" className="input" placeholder="GCash / bank ref" /></label>
                        <label className="block"><span className="label">Notes</span><input name="notes" className="input" placeholder="e.g. downpayment for all albums" /></label>
                      </div>
                      <SubmitButton>Record combined payment</SubmitButton>
                    </div>
                  </ActionForm>
                </div>
              )}

              {customer.combinedPayments.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Combined payments</h3>
                  <TableWrap>
                    <table className="table">
                      <thead><tr><th>Receipt no.</th><th>Date</th><th>Method</th><th>Split over</th><th className="text-right">Amount</th><th /></tr></thead>
                      <tbody>
                        {customer.combinedPayments.map((cp) => {
                          const live = cp.payments.filter((x) => !x.voided);
                          const isVoid = live.length === 0;
                          return (
                            <tr key={cp.id} className={isVoid ? 'text-slate-400 line-through' : ''}>
                              <td className="whitespace-nowrap">{cp.receiptNo}</td>
                              <td className="whitespace-nowrap">{fmtDateTime(cp.paidAt)}<div className="text-[11.5px] text-slate-500">{cp.receivedBy.name}</div></td>
                              <td>{PAYMENT_METHOD[cp.method]}{cp.reference ? ` · ${cp.reference}` : ''}{cp.account && <div className="text-[11.5px] text-slate-500">to {accountLabel(cp.account)}</div>}{cp.notes && <div className="text-[11.5px] italic text-slate-600">{cp.notes}</div>}</td>
                              <td>{cp.payments.map((x) => <div key={x.id} className={`text-[12px] ${x.voided ? 'text-slate-400 line-through' : ''}`}><Link href={`/orders/${x.order.id}`} className="link">{x.order.orderNo}</Link> · {peso(x.amount)}{x.voided && ' (void)'}</div>)}</td>
                              <td className="text-right whitespace-nowrap font-medium">{peso(cp.amount)}{isVoid && ' (void)'}</td>
                              <td className="min-w-[8rem] text-right">
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <Link href={`/print/combined/${cp.id}`} className="link text-xs">Receipt</Link>
                                  {!isVoid && (
                                    <details className="text-left">
                                      <summary className="cursor-pointer text-xs font-medium text-red-700">Void</summary>
                                      <ActionForm action={voidCombined.bind(null, cp.id)} confirm={`Void combined payment ${cp.receiptNo}? Its ${live.length} share${live.length === 1 ? '' : 's'} go back on the orders.`} className="mt-1 flex w-56 flex-col gap-1">
                                        <input name="reason" className="input" placeholder="Reason *" required />
                                        <input name="approvalPin" type="password" inputMode="numeric" pattern="\d{4,8}" maxLength={8} autoComplete="off" className="input" placeholder="Owner approval PIN *" required />
                                        <SubmitButton className="btn-danger btn-sm">Void</SubmitButton>
                                      </ActionForm>
                                    </details>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableWrap>
                </div>
              )}
            </div>
          )}
        </Card>
        </section>
      )}

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

      <Card title="Advance payments" actions={advance > 0 ? <span className="text-xs text-emerald-700">{peso(advance)} available — choose “Advance payment” as the method on an order</span> : null}>
        {deposits.length === 0 ? <Empty>No advance payments yet.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Receipt no.</th><th>Date</th><th>Method</th><th>Received by</th><th className="text-right">Amount</th><th className="text-right">Used</th><th className="text-right">Unused</th><th /></tr></thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.id} className={d.voided ? 'text-slate-400 line-through' : ''}>
                    <td className="whitespace-nowrap">{d.receiptNo}</td>
                    <td className="whitespace-nowrap">{fmtDateTime(d.receivedAt)}</td>
                    <td>{PAYMENT_METHOD[d.method]}{d.reference ? ` · ${d.reference}` : ''}{d.account && <div className="text-[11.5px] text-slate-500">to {accountLabel(d.account)}</div>}{d.notes && <div className="text-[11.5px] text-slate-500">{d.notes}</div>}</td>
                    <td>{d.receivedBy.name}</td>
                    <td className="text-right whitespace-nowrap font-medium">{peso(d.amount)}{d.voided && ' (void)'}</td>
                    <td className="text-right whitespace-nowrap">
                      {peso(d.used)}
                      {d.live.map((u) => <div key={u.id} className="text-[11.5px] text-slate-500"><Link href={`/orders/${u.payment.order.id}`} className="link">{u.payment.order.orderNo}</Link> · {u.payment.receiptNo} · {peso(u.amount)}</div>)}
                    </td>
                    <td className={`text-right whitespace-nowrap font-medium ${d.remaining > 0 ? 'text-emerald-700' : ''}`}>{peso(d.remaining)}</td>
                    <td className="min-w-[8rem] text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link href={`/print/advance/${d.id}`} className="link text-xs">Receipt</Link>
                        {!d.voided && d.used === 0 && (
                          <details className="text-left">
                            <summary className="cursor-pointer text-xs font-medium text-red-700">Void</summary>
                            <ActionForm action={voidDeposit.bind(null, d.id)} confirm={`Void advance payment ${d.receiptNo} (${peso(d.amount)})?`} className="mt-1 flex w-56 flex-col gap-1">
                              <input name="reason" className="input" placeholder="Reason *" required />
                              <input name="approvalPin" type="password" inputMode="numeric" pattern="\d{4,8}" maxLength={8} autoComplete="off" className="input" placeholder="Owner approval PIN *" required />
                              <SubmitButton className="btn-danger btn-sm">Void</SubmitButton>
                            </ActionForm>
                          </details>
                        )}
                      </div>
                      {d.voided && <div className="text-left text-xs text-red-700 [text-decoration:none]">VOID {fmtDateTime(d.voidedAt)} — {d.voidReason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {!customer.isInternal && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold">Record an advance payment</h3>
            <p className="mb-2 text-xs text-slate-500">Money {customer.name} gives now for a future order. It gets its own receipt and can be used as the payment method when the order is made.</p>
            <ActionForm action={addDeposit.bind(null, customer.id)} resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block"><span className="label">Amount (₱) *</span><input name="amount" className="input" inputMode="decimal" placeholder="0.00" required /></label>
                <PaymentMethodFields accounts={accounts} />
                <label className="block"><span className="label">Reference no.</span><input name="reference" className="input" placeholder="GCash / bank ref" /></label>
                <label className="block"><span className="label">Notes</span><input name="notes" className="input" placeholder="e.g. for wedding album, December" /></label>
              </div>
              <div className="mt-3"><SubmitButton>Record advance payment</SubmitButton></div>
            </ActionForm>
          </div>
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
                    <td>{PAYMENT_METHOD[p.method]}{p.reference ? ` · ${p.reference}` : ''}{p.account && <div className="text-[11.5px] text-slate-500">to {accountLabel(p.account)}</div>}{p.depositUses.length > 0 && <div className="text-[11.5px] text-slate-500">from {p.depositUses.map((u) => `${u.deposit.receiptNo} (${peso(u.amount)})`).join(', ')}</div>}{p.notes && <div className="text-[11.5px] italic text-slate-600">{p.notes}</div>}{p.combinedPayment && <div className="text-[11.5px] text-slate-500">share of combined payment <Link href={`/print/combined/${p.combinedPayment.id}`} className="link">{p.combinedPayment.receiptNo}</Link> ({peso(p.combinedPayment.amount)})</div>}</td>
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
                <thead><tr><th>Product</th><th>Applies to</th><th className="text-right">Normal price</th><th className="text-right">Less per item</th>{user.isAdmin && <th />}</tr></thead>
                <tbody>
                  {customer.specialPrices.map((sp) => (
                    <tr key={sp.id}>
                      <td>{sp.product.name}</td>
                      <td className="text-slate-600">{sp.optionValue ? `${sp.optionValue.option.name}: ${sp.optionValue.label}` : 'Any option'}</td>
                      <td className="text-right text-slate-500">{sp.optionValue && sp.optionValue.priceDelta > 0 ? peso(sp.product.basePrice + sp.optionValue.priceDelta) : sp.product.basePrice > 0 ? `${peso(sp.product.basePrice)}${sp.product.pricingMode === 'PER_SQFT' ? ' / sq ft' : ''}` : 'depends on options'}</td>
                      <td className="text-right font-semibold text-emerald-700">− {specialPriceLabel(sp, peso)}{(sp.optionValue && sp.optionValue.priceDelta > 0) || sp.product.basePrice > 0 ? <div className="text-[11px] font-normal text-slate-500">pays {peso(Math.max(0, sp.product.basePrice + (sp.optionValue?.priceDelta ?? 0) - sp.amountOff))}{sp.product.pricingMode === 'PER_SQFT' ? ' / sq ft' : ''}</div> : null}</td>
                      {user.isAdmin && <td className="text-right"><ActionForm action={removeCustomerPrice.bind(null, sp.id)} confirm={`Remove the special discount on ${sp.product.name}${sp.optionValue ? ` (${sp.optionValue.option.name}: ${sp.optionValue.label})` : ''}?`}><SubmitButton className="btn-secondary btn-sm">Remove</SubmitButton></ActionForm></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {user.isAdmin && (
            <ActionForm action={saveCustomerPrices.bind(null, customer.id)} resetOnSuccess className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <SpecialPriceRows products={products} />
              <SubmitButton>Save special discounts</SubmitButton>
              <p className="text-xs text-slate-500">Each amount is deducted from every item of that product (with its options and add-ons), e.g. ₱15 brochure − ₱3 = ₱12 each. For albums you can limit a row to one <b>Leaves</b> count, e.g. Lay Flat 8x20 · 10 leaves · less ₱200; &quot;Any leaves&quot; applies to all. Saving the same product (and leaves) again changes the amount.</p>
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
