// Advance payments: money a customer gives before there is an order (customer_deposits, each with its
// own AR receipt). Later it is used as the "Advance payment" method on an order; the draw is recorded in
// deposit_uses so the order receipt can say which advance receipt the money came from.
import 'server-only';
import type { Tx } from './db';
import { peso } from './money';

type Db = Pick<Tx, 'customerDeposit' | 'depositUse'>;

/** What the customer still has on account: active deposits less what non-voided payments drew from them. */
export async function advanceBalance(db: Db, customerId: number): Promise<number> {
  const dep = await db.customerDeposit.aggregate({ where: { customerId, voided: false }, _sum: { amount: true } });
  const used = await db.depositUse.aggregate({ where: { deposit: { customerId, voided: false }, payment: { voided: false } }, _sum: { amount: true } });
  return (dep._sum.amount ?? 0) - (used._sum.amount ?? 0);
}

/** Draw `amount` from the customer's advance payments, oldest first, and link each draw to the order payment. */
export async function applyAdvance(tx: Tx, customerId: number, paymentId: number, amount: number): Promise<{ receiptNo: string; amount: number }[]> {
  const deposits = await tx.customerDeposit.findMany({
    where: { customerId, voided: false },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    include: { uses: { where: { payment: { voided: false } }, select: { amount: true } } },
  });
  let left = amount;
  const taken: { receiptNo: string; amount: number }[] = [];
  for (const d of deposits) {
    const remaining = d.amount - d.uses.reduce((s, u) => s + u.amount, 0);
    if (remaining <= 0 || left <= 0) continue;
    const take = Math.min(remaining, left);
    await tx.depositUse.create({ data: { depositId: d.id, paymentId, amount: take } });
    taken.push({ receiptNo: d.receiptNo, amount: take });
    left -= take;
  }
  if (left > 0) throw new Error(`Only ${peso(amount - left)} of advance payment is available for this customer.`);
  return taken;
}

/** An advance payment on an order was partly voided and now stands at `newAmount`: give the rest back, newest draw first. */
export async function trimAdvanceUses(tx: Tx, paymentId: number, newAmount: number) {
  const uses = await tx.depositUse.findMany({ where: { paymentId }, orderBy: { id: 'desc' } });
  let over = uses.reduce((s, u) => s + u.amount, 0) - newAmount;
  for (const u of uses) {
    if (over <= 0) break;
    if (u.amount <= over) { await tx.depositUse.delete({ where: { id: u.id } }); over -= u.amount; }
    else { await tx.depositUse.update({ where: { id: u.id }, data: { amount: u.amount - over } }); over = 0; }
  }
}
