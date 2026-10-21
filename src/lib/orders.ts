import type { Tx } from './db';
import { prisma } from './db';
import { audit } from './audit';
import { can, type Access } from './permissions';

/** Recompute amountPaid / balance / paymentStatus from non-voided payments. */
export async function recalcOrder(tx: Tx, orderId: number) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const agg = await tx.payment.aggregate({ where: { orderId, voided: false }, _sum: { amount: true } });
  const paid = agg._sum.amount ?? 0;
  const balance = order.status === 'CANCELLED' ? 0 : order.total - paid;
  const paymentStatus = paid <= 0 ? (order.total === 0 ? 'PAID' : 'UNPAID') : paid >= order.total ? 'PAID' : 'PARTIAL';
  return tx.order.update({ where: { id: orderId }, data: { amountPaid: paid, balance, paymentStatus } });
}

/**
 * Keep the order status in step with its jobs: any job started → In Production;
 * all jobs completed → Completed. Never touches Delivered/Cancelled orders.
 */
export async function syncOrderStatusFromJobs(tx: Tx, orderId: number) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { jobs: true } });
  if (order.status === 'DELIVERED' || order.status === 'CANCELLED') return;
  const jobs = order.jobs.filter((j) => j.status !== 'CANCELLED');
  if (jobs.length === 0) return;
  let status: typeof order.status = 'PENDING';
  if (jobs.every((j) => j.status === 'COMPLETED')) status = 'COMPLETED';
  else if (jobs.some((j) => j.status !== 'PENDING')) status = 'IN_PRODUCTION';
  if (status !== order.status) await tx.order.update({ where: { id: orderId }, data: { status } });
}

/** Outstanding balance per customer, for lists and the dashboard. */
export async function customerBalances(customerIds?: number[]) {
  const rows = await prisma.order.groupBy({
    by: ['customerId'],
    where: { status: { not: 'CANCELLED' }, ...(customerIds ? { customerId: { in: customerIds } } : {}) },
    _sum: { balance: true },
    _max: { createdAt: true },
  });
  return new Map(rows.map((r) => [r.customerId, { balance: r._sum.balance ?? 0, lastOrder: r._max.createdAt }]));
}

/**
 * Mark an order Delivered / Picked up. Rule: balance must be zero unless an ADMIN overrides
 * with a reason (logged in the audit trail).
 */
export async function markOrderDelivered(
  tx: Tx,
  orderId: number,
  user: { id: number } & Access,
  overrideReason?: string | null,
) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status === 'CANCELLED') throw new Error('Cancelled orders cannot be delivered.');
  if (order.status === 'DELIVERED') return order;
  let override = false;
  if (order.balance > 0) {
    if (!can(user, 'orders_override')) throw new Error(`Balance of ₱${(order.balance / 100).toFixed(2)} must be paid first. Ask the owner to override.`);
    if (!overrideReason?.trim()) throw new Error('Enter a reason to release this order with an unpaid balance.');
    override = true;
  }
  const updated = await tx.order.update({
    where: { id: orderId },
    data: { status: 'DELIVERED', deliveredAt: new Date(), deliveredOverride: override },
  });
  await audit(tx, user.id, override ? 'OVERRIDE' : 'STATUS', 'Order', orderId,
    override ? `${order.orderNo} released with unpaid balance: ${overrideReason}` : `${order.orderNo} marked Delivered / Picked up`,
    override ? { balance: order.balance, reason: overrideReason ?? null } : undefined);
  return updated;
}
