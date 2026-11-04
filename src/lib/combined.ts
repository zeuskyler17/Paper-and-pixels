// Combined customer balance: a customer's unpaid orders shown and paid as one total. A payment toward the
// combined balance is split over the orders, oldest first; each share is an ordinary Payment on its order,
// so order records (items, totals, history) stay as they are and only their balances go down.

export type OpenOrder = { id: number; orderNo: string; createdAt: Date; total: number; amountPaid: number; balance: number };

/** Prisma filter: orders that still owe money and count toward the combined balance. */
export const OPEN_ORDER_WHERE = { status: { not: 'CANCELLED' as const }, balance: { gt: 0 } };
/** Oldest order first — the order shares are taken in. */
export const OPEN_ORDER_SORT = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

/** Split `amount` over the orders in the given order (oldest first). Returns only orders that receive money. */
export function allocate<T extends { id: number; balance: number }>(orders: T[], amount: number): { order: T; share: number; after: number }[] {
  let left = Math.max(0, Math.round(amount));
  const out: { order: T; share: number; after: number }[] = [];
  for (const o of orders) {
    if (left <= 0) break;
    const share = Math.min(o.balance, left);
    if (share <= 0) continue;
    out.push({ order: o, share, after: o.balance - share });
    left -= share;
  }
  return out;
}
