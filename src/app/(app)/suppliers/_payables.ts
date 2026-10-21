import 'server-only';
import { prisma, type Tx } from '@/lib/db';

/**
 * Supplier payables (what the shop owes its suppliers), all in centavos.
 *
 *   received = Σ over non-cancelled POs, Σ items round(receivedQty × unitCost)
 *   paid     = Σ non-voided SupplierPayments (with or without a PO)
 *   balance  = received − paid        (negative = advance / overpayment)
 *
 * Only RECEIVED quantities count: ordering goods creates no payable until they arrive.
 */
export type Payable = { received: number; paid: number; balance: number };

export const PAYABLE_FORMULA =
  'Payable = Σ (received qty × PO unit cost) over non-cancelled POs − Σ non-voided supplier payments.';

/** Value of goods received on one PO line (centavos). */
export function receivedValue(item: { receivedQty: number; unitCost: number }): number {
  return Math.round(item.receivedQty * item.unitCost);
}

/**
 * Payables per supplier. Pass supplier ids to limit the query (omit for all suppliers).
 * Suppliers with no POs or payments are present with zeros when ids are given.
 */
export async function supplierPayables(supplierIds?: number[], db: Tx | typeof prisma = prisma): Promise<Map<number, Payable>> {
  const supplierFilter = supplierIds ? { in: supplierIds } : undefined;
  const [items, payments] = await Promise.all([
    db.purchaseOrderItem.findMany({
      where: { receivedQty: { gt: 0 }, purchaseOrder: { status: { not: 'CANCELLED' }, ...(supplierFilter ? { supplierId: supplierFilter } : {}) } },
      select: { receivedQty: true, unitCost: true, purchaseOrder: { select: { supplierId: true } } },
    }),
    db.supplierPayment.groupBy({
      by: ['supplierId'],
      where: { voided: false, ...(supplierFilter ? { supplierId: supplierFilter } : {}) },
      _sum: { amount: true },
    }),
  ]);

  const map = new Map<number, Payable>();
  const get = (id: number) => {
    let p = map.get(id);
    if (!p) { p = { received: 0, paid: 0, balance: 0 }; map.set(id, p); }
    return p;
  };
  for (const id of supplierIds ?? []) get(id);
  for (const it of items) get(it.purchaseOrder.supplierId).received += receivedValue(it);
  for (const p of payments) get(p.supplierId).paid += p._sum.amount ?? 0;
  for (const p of map.values()) p.balance = p.received - p.paid;
  return map;
}

/** Payable for a single supplier. */
export async function supplierPayable(supplierId: number, db: Tx | typeof prisma = prisma): Promise<Payable> {
  return (await supplierPayables([supplierId], db)).get(supplierId) ?? { received: 0, paid: 0, balance: 0 };
}

/** Total owed to all suppliers (sum of positive balances only). */
export async function totalPayables(db: Tx | typeof prisma = prisma): Promise<number> {
  const map = await supplierPayables(undefined, db);
  let total = 0;
  for (const p of map.values()) if (p.balance > 0) total += p.balance;
  return total;
}
