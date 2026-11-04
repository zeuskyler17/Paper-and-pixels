// Server side of the combined customer balance (see combined.ts): recording and voiding a combined payment.
import 'server-only';
import type { PaymentMethod } from '@prisma/client';
import type { Tx } from './db';
import { audit } from './audit';
import { nextNumber } from './counters';
import { recalcOrder } from './orders';
import { earnForPayment, reverseForPayment } from './points';
import { peso } from './money';
import { PAYMENT_METHOD } from './labels';
import { allocate, OPEN_ORDER_SORT, OPEN_ORDER_WHERE } from './combined';

export type CombinedInput = {
  customerId: number; userId: number; amount: number; method: PaymentMethod; accountId: number | null;
  reference: string | null; notes: string | null; /** Orders to pay (empty = all unpaid orders). */ orderIds: number[];
};

/**
 * One payment toward a customer's combined balance: one AR receipt, split over the chosen unpaid orders oldest first.
 * Each share is an ordinary Payment (AR-…-1, -2…) on its order; order items and totals are not touched.
 */
export async function recordCombinedPayment(tx: Tx, a: CombinedInput) {
  const c = await tx.customer.findUniqueOrThrow({ where: { id: a.customerId }, select: { name: true, isInternal: true, combineBalances: true } });
  if (c.isInternal) throw new Error(`${c.name} is a branch of the shop — transfers are not paid for.`);
  if (!c.combineBalances) throw new Error('Turn on "Combine balances" for this customer first.');
  if (!(a.amount > 0)) throw new Error('Enter an amount greater than zero.');
  const open = await tx.order.findMany({ where: { customerId: a.customerId, ...OPEN_ORDER_WHERE }, orderBy: OPEN_ORDER_SORT, select: { id: true, orderNo: true, balance: true } });
  if (open.length === 0) throw new Error(`${c.name} has no unpaid orders.`);
  const picked = new Set(a.orderIds);
  const chosen = picked.size ? open.filter((o) => picked.has(o.id)) : open;
  if (chosen.length === 0) throw new Error('Tick at least one order to pay.');
  const owed = chosen.reduce((s, o) => s + o.balance, 0);
  if (a.amount > owed) throw new Error(`Amount is more than the balance of the chosen orders (${peso(owed)}). Record the extra as an advance payment instead.`);
  const balanceBefore = open.reduce((s, o) => s + o.balance, 0);

  const receiptNo = await nextNumber(tx, 'AR');
  const cp = await tx.combinedPayment.create({ data: {
    receiptNo, customerId: a.customerId, amount: a.amount, method: a.method, reference: a.reference, notes: a.notes,
    accountId: a.accountId, receivedById: a.userId, balanceBefore,
  } });
  const shares = allocate(chosen, a.amount);
  let k = 0;
  for (const sh of shares) {
    k += 1;
    const p = await tx.payment.create({ data: {
      receiptNo: `${receiptNo}-${k}`, orderId: sh.order.id, customerId: a.customerId, amount: sh.share, method: a.method,
      reference: a.reference, accountId: a.accountId, notes: a.notes, receivedById: a.userId, combinedPaymentId: cp.id,
    } });
    await recalcOrder(tx, sh.order.id);
    await earnForPayment(tx, p.id, a.userId);
  }
  await audit(tx, a.userId, 'CREATE', 'CombinedPayment', cp.id,
    `${receiptNo}: ${peso(a.amount)} ${PAYMENT_METHOD[a.method]} toward the combined balance of ${c.name} — ${shares.map((s) => `${s.order.orderNo} ${peso(s.share)}`).join(', ')}`,
    { amount: a.amount, method: a.method, accountId: a.accountId, reference: a.reference, notes: a.notes, balanceBefore, shares: shares.map((s) => ({ orderId: s.order.id, orderNo: s.order.orderNo, share: s.share, after: s.after })) });
  return { id: cp.id, receiptNo, balanceBefore, balanceAfter: balanceBefore - a.amount, shares };
}

/** Void every share of a combined payment still on its order; each order's balance goes back up. */
export async function voidCombinedPayment(tx: Tx, a: { combinedId: number; userId: number; approver: { id: number; name: string }; reason: string }) {
  const cp = await tx.combinedPayment.findUniqueOrThrow({ where: { id: a.combinedId }, include: { payments: { include: { order: { select: { orderNo: true } } } } } });
  const live = cp.payments.filter((p) => !p.voided);
  if (live.length === 0) throw new Error(`${cp.receiptNo} is already void.`);
  const voidData = { voided: true, voidReason: `Combined payment ${cp.receiptNo} voided: ${a.reason}`, voidedAt: new Date(), voidedById: a.userId, voidApprovedById: a.approver.id };
  for (const p of live) {
    await tx.payment.update({ where: { id: p.id }, data: voidData });
    await reverseForPayment(tx, p.id, a.userId);
    await recalcOrder(tx, p.orderId);
  }
  const total = live.reduce((s, p) => s + p.amount, 0);
  await audit(tx, a.userId, 'VOID', 'CombinedPayment', cp.id, `Voided combined payment ${cp.receiptNo} (${peso(total)}): ${a.reason} — approved by ${a.approver.name}`,
    { reason: a.reason, approvedBy: a.approver.name, shares: live.map((p) => ({ receiptNo: p.receiptNo, orderNo: p.order.orderNo, amount: p.amount })) });
  return { customerId: cp.customerId, receiptNo: cp.receiptNo, total, orderIds: live.map((p) => p.orderId) };
}
