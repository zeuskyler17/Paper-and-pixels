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
import { updateCustomer } from '../actions';
import { CustomerFields } from '../CustomerFields';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('customers');
  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id: Number(id) },
    include: {
      orders: { orderBy: { createdAt: 'desc' } },
      payments: { orderBy: { paidAt: 'desc' }, include: { order: { select: { orderNo: true } }, account: true } },
    },
  });
  if (!customer) notFound();

  const active = customer.orders.filter((o) => o.status !== 'CANCELLED');
  const balance = active.reduce((s, o) => s + o.balance, 0);
  const totalSpent = active.reduce((s, o) => s + o.total, 0);
  const lastOrder = customer.orders[0]?.createdAt;

  return (
    <div className="space-y-4">
      <PageHeader
        title={customer.name}
        subtitle={[customer.mobile, customer.facebook].filter(Boolean).join(' · ')}
        actions={<Link href={`/orders/new?customerId=${customer.id}`} className="btn-primary">+ New order</Link>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outstanding balance" value={peso(balance)} tone={balance > 0 ? 'red' : 'green'} />
        <Stat label="Total orders" value={active.length} />
        <Stat label="Total billed" value={peso(totalSpent)} />
        <Stat label="Last order" value={<span className="text-lg">{fmtDate(lastOrder)}</span>} />
      </div>

      <Card title="Orders">
        {customer.orders.length === 0 ? <Empty>No orders yet.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Order no.</th><th>Date</th><th>Status</th><th>Payment</th><th className="text-right">Total</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {customer.orders.map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/orders/${o.id}`} className="link">{o.orderNo}</Link></td>
                    <td>{fmtDate(o.createdAt)}</td>
                    <td><StatusBadge value={o.status} labels={ORDER_STATUS} /></td>
                    <td><StatusBadge value={o.paymentStatus} labels={PAYMENT_STATUS} /></td>
                    <td className="text-right">{peso(o.total)}</td>
                    <td className={`text-right font-medium ${o.balance > 0 ? 'text-red-600' : ''}`}>{peso(o.balance)}</td>
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

      <Card title="Customer details">
        <ActionForm action={updateCustomer.bind(null, customer.id)} className="space-y-4">
          <CustomerFields c={customer} />
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
