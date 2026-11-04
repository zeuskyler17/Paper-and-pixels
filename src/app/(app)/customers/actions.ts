'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, optInt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { nextNumber } from '@/lib/counters';
import { peso, toCentavos } from '@/lib/money';
import { MONEY_METHODS, PAYMENT_METHOD } from '@/lib/labels';
import { resolvePaymentAccount } from '@/lib/paymentAccounts';
import { verifyApprovalPin } from '@/lib/approval';
import type { PaymentMethod } from '@prisma/client';
import { recordCombinedPayment, voidCombinedPayment } from '@/lib/combinedPay';

function readCustomer(fd: FormData) {
  const name = str(fd, 'name');
  if (!name) throw new Error('Customer name is required.');
  return {
    name,
    mobile: optStr(fd, 'mobile'),
    facebook: optStr(fd, 'facebook'),
    email: optStr(fd, 'email'),
    address: optStr(fd, 'address'),
    notes: optStr(fd, 'notes'), isInternal: fd.get('isInternal') === 'on',
  };
}

export async function createCustomer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await attempt(async () => {
    const user = await assertUser('customers');
    const data = readCustomer(fd);
    const c = await prisma.$transaction(async (tx) => {
      const c = await tx.customer.create({ data });
      await audit(tx, user.id, 'CREATE', 'Customer', c.id, `Created customer ${c.name}`, data);
      return c;
    });
    id = c.id;
  });
  if (res?.error) return res;
  redirect(`/customers/${id}`);
}

export async function updateCustomer(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('customers');
    const data = readCustomer(fd);
    await prisma.$transaction(async (tx) => {
      const before = await tx.customer.findUniqueOrThrow({ where: { id } });
      await tx.customer.update({ where: { id }, data });
      await audit(tx, user.id, 'UPDATE', 'Customer', id, `Updated customer ${data.name}`, { before, after: data });
    });
    revalidatePath(`/customers/${id}`);
    return { ok: 'Customer saved.' };
  });
}

/** Owner/admin only: hide (or show again) this customer's balance from non-admin logins. */
export async function setBalanceHidden(id: number, hidden: boolean, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('admin');
    await prisma.$transaction(async (tx) => {
      const c = await tx.customer.update({ where: { id }, data: { balanceHidden: hidden } });
      await audit(tx, user.id, 'UPDATE', 'Customer', id, `${hidden ? 'Hid' : 'Showed'} the balance of ${c.name} ${hidden ? 'from' : 'to'} staff`, { balanceHidden: hidden });
    });
    revalidatePath(`/customers/${id}`);
    revalidatePath('/customers');
    revalidatePath('/dashboard');
    return { ok: hidden ? 'Balance hidden from staff.' : 'Balance visible to staff again.' };
  });
}

/** Owner/admin only: add or change this customer's special discounts — one row per product (₱ deducted from each item),
 * optionally only for a chosen option value such as a Leaves count. Several rows can be saved at once. */
export async function saveCustomerPrices(customerId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('admin');
    const rows: { productId: number; optionValueId: number | null; amountOff: number }[] = [];
    for (let i = 0; i < 20; i++) {
      if (!fd.has(`productId_${i}`) && !fd.has(`value_${i}`)) continue;
      const productId = Number(fd.get(`productId_${i}`));
      const raw = String(fd.get(`value_${i}`) ?? '').trim().replace(/[₱,\s]/g, '');
      if (!productId && raw === '') continue; // empty row
      if (!productId) throw new Error(`Row ${i + 1}: choose a product.`);
      const value = Number(raw);
      if (raw === '' || !Number.isFinite(value) || !(value > 0)) throw new Error(`Row ${i + 1}: enter the amount to deduct per item, e.g. 3 or 200.`);
      const ov = Number(fd.get(`optionValueId_${i}`)) || null;
      rows.push({ productId, optionValueId: ov, amountOff: Math.round(value * 100) });
    }
    if (rows.length === 0) throw new Error('Choose at least one product and amount.');
    const saved: string[] = [];
    await prisma.$transaction(async (tx) => {
      const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      for (const r of rows) {
        const p = await tx.product.findUniqueOrThrow({ where: { id: r.productId } });
        const ov = r.optionValueId ? await tx.productOptionValue.findFirst({ where: { id: r.optionValueId, option: { productId: r.productId } }, include: { option: true } }) : null;
        if (r.optionValueId && !ov) throw new Error(`${p.name}: that option value does not belong to this product.`);
        const existing = await tx.customerPrice.findFirst({ where: { customerId, productId: r.productId, optionValueId: r.optionValueId } });
        if (existing) await tx.customerPrice.update({ where: { id: existing.id }, data: { amountOff: r.amountOff } });
        else await tx.customerPrice.create({ data: { customerId, productId: r.productId, optionValueId: r.optionValueId, amountOff: r.amountOff, createdById: user.id } });
        const what = `${p.name}${ov ? ` (${ov.option.name}: ${ov.label})` : ''} — ₱${(r.amountOff / 100).toFixed(2)} off each`;
        saved.push(what);
        await audit(tx, user.id, 'UPDATE', 'Customer', customerId, `Special discount for ${c.name}: ${what}`, r);
      }
    });
    revalidatePath(`/customers/${customerId}`);
    revalidatePath('/customers');
    return { ok: `Saved ${saved.length} special discount${saved.length === 1 ? '' : 's'}: ${saved.join('; ')}. New orders deduct them automatically.` };
  });
}

/** Owner/admin only: remove one special discount. */
export async function removeCustomerPrice(id: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('admin');
    const cp = await prisma.customerPrice.findUniqueOrThrow({ where: { id }, include: { customer: true, product: true } });
    await prisma.$transaction(async (tx) => {
      await tx.customerPrice.delete({ where: { id } });
      await audit(tx, user.id, 'UPDATE', 'Customer', cp.customerId, `Removed the special price of ${cp.customer.name} on ${cp.product.name}`, { productId: cp.productId });
    });
    revalidatePath(`/customers/${cp.customerId}`);
    revalidatePath('/customers');
    return { ok: 'Special price removed.' };
  });
}

/** Record money a customer gives in advance (before an order). Gets its own AR receipt; used later as the "Advance payment" method. */
export async function addDeposit(customerId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('orders');
    const amount = toCentavos(fd.get('amount'));
    if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
    const method = str(fd, 'method');
    if (!(method in MONEY_METHODS)) throw new Error('Choose how the money was received.');
    const reference = optStr(fd, 'reference');
    const notes = optStr(fd, 'notes');
    let receiptNo = '';
    await prisma.$transaction(async (tx) => {
      const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { name: true, isInternal: true } });
      if (c.isInternal) throw new Error(`${c.name} is a branch of the shop — branches do not pay in advance.`);
      const accountId = await resolvePaymentAccount(tx, method as PaymentMethod, optInt(fd, 'accountId'));
      receiptNo = await nextNumber(tx, 'AR');
      const d = await tx.customerDeposit.create({ data: { receiptNo, customerId, amount, method: method as PaymentMethod, reference, notes, accountId, receivedById: user.id } });
      await audit(tx, user.id, 'CREATE', 'Deposit', d.id, `${receiptNo}: advance payment ${peso(amount)} ${PAYMENT_METHOD[method]} from ${c.name}`, { customerId, amount, method, accountId, reference, notes });
    });
    revalidatePath(`/customers/${customerId}`);
    revalidatePath('/customers');
    return { ok: `Advance payment recorded — receipt ${receiptNo}.` };
  });
}

/** Void an advance payment that has not been used on any order (owner approval PIN). */
export async function voidDeposit(depositId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let customerId = 0;
  const res = await attempt(async () => {
    const user = await assertUser('orders');
    const reason = str(fd, 'reason');
    if (!reason) throw new Error('Enter the reason for voiding this advance payment.');
    await prisma.$transaction(async (tx) => {
      const d = await tx.customerDeposit.findUniqueOrThrow({ where: { id: depositId }, include: { uses: { where: { payment: { voided: false } }, include: { payment: { select: { receiptNo: true, order: { select: { orderNo: true } } } } } } } });
      customerId = d.customerId;
      if (d.voided) throw new Error('This advance payment is already void.');
      if (d.uses.length) throw new Error(`This advance payment was already used on ${d.uses.map((u) => `${u.payment.order.orderNo} (${u.payment.receiptNo})`).join(', ')}. Void those payments first.`);
      const approver = await verifyApprovalPin(tx, str(fd, 'approvalPin'), user.id, 'a void');
      await tx.customerDeposit.update({ where: { id: depositId }, data: { voided: true, voidReason: reason, voidedAt: new Date(), voidedById: user.id } });
      await audit(tx, user.id, 'VOID', 'Deposit', depositId, `Voided advance payment ${d.receiptNo} (${peso(d.amount)}): ${reason} — approved by ${approver.name}`, { amount: d.amount, reason, approvedBy: approver.name });
    });
    return { ok: 'Advance payment voided.' };
  });
  if (customerId) { revalidatePath(`/customers/${customerId}`); revalidatePath('/customers'); }
  return res;
}

// ───────── combined customer balance ─────────

/** Turn the combined balance on or off for a customer (their unpaid orders are then shown and paid as one total). */
export async function setCombineBalances(id: number, on: boolean, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('orders');
    await prisma.$transaction(async (tx) => {
      const c = await tx.customer.findUniqueOrThrow({ where: { id }, select: { name: true, isInternal: true } });
      if (c.isInternal) throw new Error(`${c.name} is a branch of the shop — branch transfers have no balance.`);
      await tx.customer.update({ where: { id }, data: { combineBalances: on } });
      await audit(tx, user.id, 'UPDATE', 'Customer', id, `${on ? 'Combined' : 'Separated'} the order balances of ${c.name}`, { combineBalances: on });
    });
    revalidatePath(`/customers/${id}`);
    return { ok: on ? 'Balances combined — payments can now be taken against the total.' : 'Balances shown per order again.' };
  });
}

/**
 * Receive one payment toward the customer's combined balance. It gets one acknowledgement receipt (AR-…); the money
 * is split over the chosen unpaid orders, oldest first, as ordinary payments AR-…-1, AR-…-2 on each order.
 * Order items and totals never change — only each order's balance goes down by its share.
 */
export async function payCombined(customerId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const touched: number[] = [];
  const res = await attempt(async () => {
    const user = await assertUser('orders');
    const amount = toCentavos(fd.get('amount'));
    if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
    const method = str(fd, 'method');
    if (!(method in MONEY_METHODS)) throw new Error('Choose how the money was received.');
    let msg = '';
    await prisma.$transaction(async (tx) => {
      const accountId = await resolvePaymentAccount(tx, method as PaymentMethod, optInt(fd, 'accountId'));
      const r = await recordCombinedPayment(tx, {
        customerId, userId: user.id, amount, method: method as PaymentMethod, accountId,
        reference: optStr(fd, 'reference'), notes: optStr(fd, 'notes'), orderIds: fd.getAll('orderId').map(Number).filter((n) => n > 0),
      });
      touched.push(...r.shares.map((s) => s.order.id));
      msg = `Combined payment recorded — receipt ${r.receiptNo}, split over ${r.shares.length} order${r.shares.length === 1 ? '' : 's'}. Combined balance is now ${peso(r.balanceAfter)}.`;
    });
    return { ok: msg };
  });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath('/customers');
  revalidatePath('/orders');
  revalidatePath('/dashboard');
  for (const id of touched) revalidatePath(`/orders/${id}`);
  return res;
}

/** Void a whole combined payment: every share still on its order is voided and the orders' balances go back up (owner PIN). */
export async function voidCombined(combinedId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let customerId = 0;
  const touched: number[] = [];
  const res = await attempt(async () => {
    const user = await assertUser('orders');
    const reason = str(fd, 'reason');
    if (!reason) throw new Error('Enter the reason for voiding this payment.');
    let msg = '';
    await prisma.$transaction(async (tx) => {
      const approver = await verifyApprovalPin(tx, str(fd, 'approvalPin'), user.id, 'a void');
      const r = await voidCombinedPayment(tx, { combinedId, userId: user.id, approver, reason });
      customerId = r.customerId;
      touched.push(...r.orderIds);
      msg = `Combined payment ${r.receiptNo} voided — ${peso(r.total)} is back on ${r.orderIds.length} order${r.orderIds.length === 1 ? '' : 's'}.`;
    });
    return { ok: msg };
  });
  if (customerId) { revalidatePath(`/customers/${customerId}`); revalidatePath('/customers'); revalidatePath('/dashboard'); }
  for (const id of touched) revalidatePath(`/orders/${id}`);
  return res;
}
