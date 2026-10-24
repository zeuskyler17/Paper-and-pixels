// Loyalty points promo: earned on payments received, used as pesos off new orders.
// The owner switches it on/off and sets the rates in Settings. Every change is a row in points_entries;
// customers.points is the running balance and customers.pointsCarry the pesos not yet worth a full step.
import 'server-only';
import type { Tx } from './db';
import { getSettings, type Settings } from './settings';
import { addDays, parseDateInput, todayManila } from './dates';

/** The owner has not released the points promo yet: keep it off and its settings hidden. Set to true to release. */
export const POINTS_RELEASED = false;

export type PointsConfig = {
  enabled: boolean;
  /** Pesos (in centavos) paid per earning step, e.g. 50000 = ₱500. */
  stepCentavos: number;
  /** Points per step, e.g. 3. */
  perStep: number;
  /** What one point takes off an order (centavos), e.g. 1000 = ₱10. */
  valueCentavos: number;
  /** Most points one customer may use in a week (Mon–Sun); 0 = no limit. */
  weekCap: number;
};

const num = (v: string, d: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : d);

export function pointsConfig(s: Settings): PointsConfig {
  return {
    enabled: POINTS_RELEASED && s.points_enabled === 'true',
    stepCentavos: Math.round(num(s.points_step, 500) * 100),
    perStep: Math.round(num(s.points_per_step, 3)),
    valueCentavos: Math.round(num(s.point_value, 10) * 100),
    weekCap: Math.round(num(s.points_redeem_week_cap, 300)),
  };
}

export async function getPointsConfig() {
  return pointsConfig(await getSettings());
}

/** Monday 00:00 (Manila) of the current week. */
export function weekStart(): Date {
  const today = todayManila();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sun
  return parseDateInput(addDays(today, -((dow + 6) % 7)))!;
}

/** Points this customer has already used this week (net of refunds). */
export async function usedThisWeek(tx: Tx, customerId: number): Promise<number> {
  const rows = await tx.pointsEntry.aggregate({
    where: { customerId, kind: { in: ['REDEEM', 'REFUND'] }, createdAt: { gte: weekStart() } },
    _sum: { points: true },
  });
  return Math.max(0, -(rows._sum.points ?? 0));
}

async function post(tx: Tx, customerId: number, points: number, kind: string, extra: { paymentId?: number | null; orderId?: number | null; note?: string | null; userId?: number | null }) {
  if (points === 0) return;
  await tx.pointsEntry.create({ data: { customerId, points, kind, paymentId: extra.paymentId ?? null, orderId: extra.orderId ?? null, note: extra.note ?? null, createdById: extra.userId ?? null } });
  await tx.customer.update({ where: { id: customerId }, data: { points: { increment: points } } });
}

/**
 * Award points for a payment (promo on, not a branch transfer, order did not use a special discount).
 * Pesos below a full step carry over to the customer's next payment. Returns the points earned.
 */
export async function earnForPayment(tx: Tx, paymentId: number, userId: number | null, cfg?: PointsConfig): Promise<number> {
  const c = cfg ?? (await getPointsConfig());
  if (!c.enabled || c.stepCentavos <= 0 || c.perStep <= 0) return 0;
  const p = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { order: { select: { id: true, orderNo: true, earnsPoints: true } }, customer: { select: { id: true, isInternal: true, pointsCarry: true } } },
  });
  if (p.voided || p.customer.isInternal || !p.order.earnsPoints) return 0;
  const pool = p.customer.pointsCarry + p.amount;
  const steps = Math.floor(pool / c.stepCentavos);
  const points = steps * c.perStep;
  await tx.customer.update({ where: { id: p.customerId }, data: { pointsCarry: pool - steps * c.stepCentavos } });
  await post(tx, p.customerId, points, 'EARN', { paymentId, orderId: p.orderId, userId, note: `${p.receiptNo} on ${p.order.orderNo}` });
  return points;
}

/** Take back the points a payment earned (the payment was voided). */
export async function reverseForPayment(tx: Tx, paymentId: number, userId: number | null): Promise<number> {
  const rows = await tx.pointsEntry.findMany({ where: { paymentId, kind: { in: ['EARN', 'REVERSE'] } }, select: { points: true, customerId: true, orderId: true } });
  const net = rows.reduce((s, r) => s + r.points, 0);
  if (net <= 0) return 0;
  await post(tx, rows[0].customerId, -net, 'REVERSE', { paymentId, orderId: rows[0].orderId, userId, note: 'Payment voided' });
  return net;
}

/** Points used on a new order (already validated). */
export async function redeemOnOrder(tx: Tx, customerId: number, orderId: number, orderNo: string, points: number, userId: number) {
  await post(tx, customerId, -points, 'REDEEM', { orderId, userId, note: `Used on ${orderNo}` });
}

/** Give back the points used on an order (the order was cancelled). */
export async function refundForOrder(tx: Tx, orderId: number, userId: number): Promise<number> {
  const rows = await tx.pointsEntry.findMany({ where: { orderId, kind: { in: ['REDEEM', 'REFUND'] } }, select: { points: true, customerId: true } });
  const owed = -rows.reduce((s, r) => s + r.points, 0);
  if (owed <= 0) return 0;
  await post(tx, rows[0].customerId, owed, 'REFUND', { orderId, userId, note: 'Order cancelled — points returned' });
  return owed;
}

/** Owner/admin manual change (bonus, correction). */
export async function adjustPoints(tx: Tx, customerId: number, points: number, note: string, userId: number) {
  await post(tx, customerId, points, 'ADJUST', { userId, note });
}

/** Owner/admin "Refresh points": every customer back to 0 points and no carry-over (ledger keeps the history). */
export async function resetAllPoints(tx: Tx, userId: number): Promise<{ customers: number; points: number }> {
  const withPoints = await tx.customer.findMany({ where: { OR: [{ points: { not: 0 } }, { pointsCarry: { not: 0 } }] }, select: { id: true, points: true } });
  for (const c of withPoints) {
    if (c.points !== 0) await tx.pointsEntry.create({ data: { customerId: c.id, points: -c.points, kind: 'RESET', note: 'Points refreshed by the owner', createdById: userId } });
  }
  await tx.customer.updateMany({ where: { id: { in: withPoints.map((c) => c.id) } }, data: { points: 0, pointsCarry: 0 } });
  return { customers: withPoints.length, points: withPoints.reduce((s, c) => s + c.points, 0) };
}
