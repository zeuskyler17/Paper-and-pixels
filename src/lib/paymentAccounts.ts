// Receiving accounts (GCash / Maya / bank) for customer payments.
import type { PaymentMethod } from '@prisma/client';
import type { Tx } from './db';
import { PAYMENT_METHOD } from './labels';

export type AccountLite = { id: number; method: PaymentMethod | string; label: string; accountName?: string | null; accountNumber?: string | null };

/** "Jc's GCash · 0917 555 0101" */
export function accountLabel(a: AccountLite | null | undefined): string {
  if (!a) return '';
  return `${a.label}${a.accountNumber ? ` · ${a.accountNumber}` : ''}`;
}

/** Methods that go into an account (everything except cash). */
export const ACCOUNT_METHODS: PaymentMethod[] = ['GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'];

/**
 * Validate the receiving account for a payment. Cash → null. For other methods, once at least one
 * active account of that method exists, choosing one is required and it must match the method.
 */
export async function resolvePaymentAccount(tx: Tx, method: PaymentMethod, accountId: number | null | undefined): Promise<number | null> {
  if (method === 'CASH') return null;
  const accounts = await tx.paymentAccount.findMany({ where: { method, active: true }, select: { id: true } });
  if (!accountId) {
    if (accounts.length > 0) throw new Error(`Choose which ${PAYMENT_METHOD[method]} account received the payment.`);
    return null;
  }
  if (!accounts.some((a) => a.id === accountId)) throw new Error(`The selected account is not an active ${PAYMENT_METHOD[method]} account.`);
  return accountId;
}
