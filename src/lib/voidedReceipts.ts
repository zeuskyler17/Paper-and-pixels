// Cancelled (voided) receipts: order payments (AR-…, partial voids AR-…-V1) and advance payments, in one list.
// The owner sees the ones not yet marked "seen" on the dashboard.
import 'server-only';
import { prisma } from './db';

export type VoidedReceipt = {
  kind: 'payment' | 'deposit';
  id: number;
  receiptNo: string;
  amount: number;
  method: string;
  customerId: number;
  customer: string;
  order: { id: number; orderNo: string } | null;
  receivedAt: Date;
  receivedBy: string;
  voidedAt: Date | null;
  voidedBy: string | null;
  approvedBy: string | null;
  reason: string | null;
  seenAt: Date | null;
  seenBy: string | null;
};

const name = { select: { name: true } } as const;

/** Newest void first. `unseen` = only those the owner has not marked as seen. */
export async function voidedReceipts({ unseen = false, take = 300 }: { unseen?: boolean; take?: number } = {}): Promise<VoidedReceipt[]> {
  const where = { voided: true, ...(unseen ? { voidSeenAt: null } : {}) };
  const order = [{ voidedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }] as const;
  const [payments, deposits] = await Promise.all([
    prisma.payment.findMany({
      where, orderBy: [...order], take,
      include: { customer: name, order: { select: { id: true, orderNo: true } }, receivedBy: name, voidedBy: name, voidApprovedBy: name, voidSeenBy: name },
    }),
    prisma.customerDeposit.findMany({
      where, orderBy: [...order], take,
      include: { customer: name, receivedBy: name, voidedBy: name, voidSeenBy: name },
    }),
  ]);
  const rows: VoidedReceipt[] = [
    ...payments.map((p) => ({
      kind: 'payment' as const, id: p.id, receiptNo: p.receiptNo, amount: p.amount, method: p.method, customerId: p.customerId, customer: p.customer.name,
      order: p.order, receivedAt: p.paidAt, receivedBy: p.receivedBy.name, voidedAt: p.voidedAt, voidedBy: p.voidedBy?.name ?? null,
      approvedBy: p.voidApprovedBy?.name ?? null, reason: p.voidReason, seenAt: p.voidSeenAt, seenBy: p.voidSeenBy?.name ?? null,
    })),
    ...deposits.map((d) => ({
      kind: 'deposit' as const, id: d.id, receiptNo: d.receiptNo, amount: d.amount, method: d.method, customerId: d.customerId, customer: d.customer.name,
      order: null, receivedAt: d.receivedAt, receivedBy: d.receivedBy.name, voidedAt: d.voidedAt, voidedBy: d.voidedBy?.name ?? null,
      approvedBy: null, reason: d.voidReason, seenAt: d.voidSeenAt, seenBy: d.voidSeenBy?.name ?? null,
    })),
  ];
  return rows.sort((a, b) => (b.voidedAt?.getTime() ?? 0) - (a.voidedAt?.getTime() ?? 0)).slice(0, take);
}

export async function unseenVoidCount() {
  const [p, d] = await Promise.all([
    prisma.payment.count({ where: { voided: true, voidSeenAt: null } }),
    prisma.customerDeposit.count({ where: { voided: true, voidSeenAt: null } }),
  ]);
  return p + d;
}
