import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { ORDER_STATUS } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, DL, Empty, FilterBar, PageHeader, StatusBadge, TableWrap } from '@/components/ui';
import { createDelivery } from '../actions';
import { DeliveryFields } from '../DeliveryFields';

export const metadata = { title: 'New delivery' };

type SP = Promise<{ orderId?: string; q?: string }>;

export default async function NewDeliveryPage({ searchParams }: { searchParams: SP }) {
  await requireUser('deliveries');
  const { orderId, q = '' } = await searchParams;

  const order = orderId && Number.isInteger(Number(orderId))
    ? await prisma.order.findUnique({
      where: { id: Number(orderId) },
      include: { customer: true, deliveries: { orderBy: { createdAt: 'desc' } } },
    })
    : null;

  if (!order) {
    const results = q
      ? await prisma.order.findMany({
        where: {
          status: { notIn: ['CANCELLED'] },
          OR: [{ orderNo: { contains: q, mode: 'insensitive' } }, { customer: { name: { contains: q, mode: 'insensitive' } } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { customer: { select: { name: true } } },
      })
      : [];
    return (
      <div className="max-w-3xl">
        <PageHeader title="New delivery / pickup" subtitle="First choose the order." />
        <Card>
          {orderId && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Order not found.</p>}
          <FilterBar>
            <input name="q" defaultValue={q} placeholder="Search order no. or customer" className="input w-64" autoFocus />
          </FilterBar>
          {!q ? <Empty>Search for an order to schedule its delivery or pickup.</Empty> : results.length === 0 ? <Empty>No matching orders.</Empty> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Order no.</th><th>Customer</th><th>Date</th><th>Status</th><th className="text-right">Balance</th><th /></tr></thead>
                <tbody>
                  {results.map((o) => (
                    <tr key={o.id}>
                      <td className="font-medium">{o.orderNo}</td>
                      <td>{o.customer.name}</td>
                      <td>{fmtDate(o.createdAt)}</td>
                      <td><StatusBadge value={o.status} labels={ORDER_STATUS} /></td>
                      <td className={`text-right ${o.balance > 0 ? 'text-red-600' : ''}`}>{peso(o.balance)}</td>
                      <td><Link href={`/deliveries/new?orderId=${o.id}`} className="btn-secondary btn-sm">Select</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    );
  }

  const cancelled = order.status === 'CANCELLED';

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="New delivery / pickup" subtitle={`For order ${order.orderNo}`} actions={<Link href="/deliveries/new" className="btn-secondary">Choose another order</Link>} />
      <Card title="Order">
        <DL items={[
          ['Order no.', <Link key="o" href={`/orders/${order.id}`} className="link">{order.orderNo}</Link>],
          ['Customer', order.customer.name],
          ['Status', <StatusBadge key="s" value={order.status} labels={ORDER_STATUS} />],
          ['Balance', <span key="b" className={order.balance > 0 ? 'font-semibold text-red-600' : ''}>{peso(order.balance)}</span>],
          ['Existing records', order.deliveries.length ? order.deliveries.map((d) => (
            <Link key={d.id} href={`/deliveries/${d.id}`} className="link mr-2">#{d.id}</Link>
          )) : 'None'],
        ]} />
      </Card>
      <Card title="Delivery details">
        {cancelled ? <Empty>This order was cancelled.</Empty> : (
          <ActionForm action={createDelivery} className="space-y-4">
            <input type="hidden" name="orderId" value={order.id} />
            <DeliveryFields d={{
              method: 'PICKUP',
              recipient: order.customer.name,
              contactNo: order.customer.mobile,
              address: order.customer.address,
              scheduledDate: order.targetDate,
            }} />
            <SubmitButton>Save delivery</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
