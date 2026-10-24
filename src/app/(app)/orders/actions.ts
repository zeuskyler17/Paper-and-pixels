'use server';

import { revalidatePath } from 'next/cache';
import type { FileSource, OrderStatus, PaymentMethod, PaymentTerms, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, logActionError, optInt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { nextNumber } from '@/lib/counters';
import { applySpecialPrice, computeUnitPrice } from '@/lib/pricing';
import { earnForPayment, getPointsConfig, redeemOnOrder, refundForOrder, reverseForPayment, usedThisWeek } from '@/lib/points';
import { recalcOrder, markOrderDelivered } from '@/lib/orders';
import { deductBomForOrderItem, returnJobMaterials, returnOrderLineMaterials } from '@/lib/inventory';
import { verifyApprovalPin } from '@/lib/approval';
import { resolvePaymentAccount } from '@/lib/paymentAccounts';
import { peso, toCentavos, toCentavosOrZero } from '@/lib/money';
import { parseDateInput } from '@/lib/dates';
import { FILE_SOURCE, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_TERMS } from '@/lib/labels';
import {
  POS_PRODUCT_INCLUDE, sanitizeSelection, toPosProduct,
  type CreateOrderInput, type JsonResult, type PosCustomer,
} from './_lib';

function errMsg(e: unknown) {
  logActionError(e);
  return e instanceof Error ? e.message : 'Something went wrong.';
}

function isKey<T extends string>(map: Record<string, string>, v: unknown): v is T {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);
}

function revalidateOrder(orderId: number) {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/orders');
  revalidatePath('/dashboard');
}

// ───────── POS helpers (called directly from the client) ─────────

/** The pre-approved part of a discount: the customer's special % of the subtotal (0 when none). */
function specialDiscountAmount(pct: number | null | undefined, subtotal: number): number {
  return pct && pct > 0 ? Math.round((subtotal * Math.min(pct, 100)) / 100) : 0;
}

export async function searchCustomers(q: string): Promise<PosCustomer[]> {
  await assertUser('orders');
  const term = String(q ?? '').trim();
  return prisma.customer.findMany({
    where: term
      ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { mobile: { contains: term } }, { facebook: { contains: term, mode: 'insensitive' } }] }
      : {},
    orderBy: term ? { name: 'asc' } : { updatedAt: 'desc' },
    take: 15,
    select: { id: true, name: true, mobile: true, facebook: true, isInternal: true, specialDiscountPct: true, specialPrices: { select: { productId: true, amountOff: true } }, points: true },
  });
}

export async function quickCreateCustomer(input: { name: string; mobile: string; facebook: string }): Promise<JsonResult & { customer?: PosCustomer }> {
  try {
    const user = await assertUser('orders');
    const name = String(input?.name ?? '').trim();
    if (!name) return { error: 'Customer name is required.' };
    const data = { name, mobile: String(input.mobile ?? '').trim() || null, facebook: String(input.facebook ?? '').trim() || null };
    const c = await prisma.$transaction(async (tx) => {
      const c = await tx.customer.create({ data });
      await audit(tx, user.id, 'CREATE', 'Customer', c.id, `Created customer ${c.name} (from POS)`, data);
      return c;
    });
    revalidatePath('/customers');
    return { id: c.id, customer: { id: c.id, name: c.name, mobile: c.mobile, facebook: c.facebook, specialPrices: [] } };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

// ───────── create order (POS save) ─────────

export async function createOrder(input: CreateOrderInput): Promise<JsonResult> {
  try {
    const user = await assertUser('orders');

    const customerId = Number(input?.customerId);
    if (!customerId) return { error: 'Choose or create a customer.' };
    const lines = Array.isArray(input?.lines) ? input.lines : [];
    if (lines.length === 0) return { error: 'Add at least one item.' };
    if (!isKey<PaymentTerms>(PAYMENT_TERMS, input.paymentTerms)) return { error: 'Choose the payment terms.' };
    const terms = input.paymentTerms;
    const targetDate = input.targetDate ? parseDateInput(input.targetDate) : null;
    if (input.targetDate && !targetDate) return { error: 'Target date is invalid.' };
    const notes = String(input.notes ?? '').trim() || null;
    const discount = Math.round(Number(input.discount) || 0);
    const discountReason = String(input.discountReason ?? '').trim() || null;
    const amountPaid = Math.round(Number(input.amountPaid) || 0);
    const reference = String(input.reference ?? '').trim() || null;

    const order = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId }, include: { specialPrices: true } });
      if (!customer) throw new Error('Customer not found.');
      const specialBy = new Map(customer.specialPrices.map((sp) => [sp.productId, sp]));
      // Own branch: a stock transfer, not a sale — no prices, discounts or payments.
      const internal = customer.isInternal;
      if (internal && (discount > 0 || amountPaid > 0)) throw new Error(`${customer.name} is a branch of the shop: transfers have no prices, discounts or payments.`);

      const productIds = [...new Set(lines.map((l) => Number(l.productId)))];
      const products = await tx.product.findMany({ where: { id: { in: productIds } }, include: POS_PRODUCT_INCLUDE });
      const byId = new Map(products.map((p) => [p.id, p]));

      const errors: string[] = [];
      const prepared = lines.map((l, i) => {
        const n = i + 1;
        const row = byId.get(Number(l.productId));
        if (!row) { errors.push(`Item ${n}: product not found.`); return null; }
        if (!row.active) { errors.push(`Item ${n}: ${row.name} is no longer sold.`); return null; }
        const product = toPosProduct(row);
        const { selection, errors: selErrors } = sanitizeSelection(product, l.selection as Record<string, unknown>);
        errors.push(...selErrors.map((e) => `Item ${n}: ${e}`));

        const perSqft = product.pricingMode === 'PER_SQFT';
        const widthFt = perSqft ? Number(l.widthFt) : null;
        const heightFt = perSqft ? Number(l.heightFt) : null;
        const price = computeUnitPrice(product, selection, widthFt, heightFt);
        errors.push(...price.errors.map((e) => `Item ${n}: ${e}`));

        const quantity = Number(l.quantity);
        if (!Number.isInteger(quantity) || quantity < 1) errors.push(`Item ${n}: quantity must be a whole number of at least 1.`);

        // The customer's special price (set by the owner) becomes the normal price for this order: no reason or approval needed.
        const special = internal ? null : applySpecialPrice(price.unitPrice, specialBy.get(product.id));
        const suggested = internal ? 0 : special ?? price.unitPrice;
        let unitPrice = suggested;
        let overrideReason: string | null = null;
        if (!internal && l.unitPrice !== null && l.unitPrice !== undefined) {
          const up = Number(l.unitPrice);
          if (!Number.isInteger(up) || up < 0) errors.push(`Item ${n}: unit price is invalid.`);
          else if (up !== suggested) {
            unitPrice = up;
            overrideReason = String(l.overrideReason ?? '').trim() || null;
            if (!overrideReason) errors.push(`Item ${n}: enter a reason for changing the price of ${product.name} (suggested ${peso(suggested)}).`);
          }
        }
        const fileSource: FileSource = isKey<FileSource>(FILE_SOURCE, l.fileSource) ? l.fileSource : 'NONE';
        return {
          product,
          widthFt: perSqft && widthFt! > 0 ? widthFt : null,
          heightFt: perSqft && heightFt! > 0 ? heightFt : null,
          quantity,
          suggested,
          unitPrice,
          overrideReason,
          lineTotal: unitPrice * (Number.isInteger(quantity) ? quantity : 0),
          specialUsed: special !== null,
          specs: price.specs,
          specsNotes: String(l.specsNotes ?? '').trim() || null,
          fileSource,
          fileSourceNote: fileSource === 'NONE' ? null : String(l.fileSourceNote ?? '').trim() || null,
        };
      });
      if (errors.length) throw new Error(errors.join('\n'));
      const items = prepared.filter((x): x is NonNullable<typeof x> => x !== null);

      const subtotal = items.reduce((s, x) => s + x.lineTotal, 0);
      if (discount < 0) throw new Error('Discount cannot be negative.');
      if (discount > subtotal) throw new Error('Discount cannot be more than the subtotal.');
      // The customer's special discount (set by the owner) is pre-approved: no PIN up to that amount.
      const special = specialDiscountAmount(customer.specialDiscountPct, subtotal);
      const preApproved = discount > 0 && discount <= special;
      const reason = discountReason ?? (preApproved ? `Special customer discount (${customer.specialDiscountPct}%)` : null);
      if (discount > 0 && !reason) throw new Error('Enter a reason for the discount.');
      const approver = discount > 0 && !preApproved ? await verifyApprovalPin(tx, input.discountPin, user.id, 'a discount') : null;

      // Loyalty points used as pesos off (promo on, enough points, weekly limit, not more than the order).
      const pts = await getPointsConfig();
      const pointsUsed = Math.max(0, Math.floor(Number(input.pointsUsed) || 0));
      let pointsAmount = 0;
      if (pointsUsed > 0) {
        if (!pts.enabled) throw new Error('The points promo is off.');
        if (internal) throw new Error('Branch transfers cannot use points.');
        if (pointsUsed > customer.points) throw new Error(`${customer.name} has only ${customer.points} point(s).`);
        if (pts.weekCap > 0) {
          const used = await usedThisWeek(tx, customerId);
          if (used + pointsUsed > pts.weekCap) throw new Error(`${customer.name} can use at most ${pts.weekCap} points a week — ${Math.max(0, pts.weekCap - used)} left this week.`);
        }
        pointsAmount = pointsUsed * pts.valueCentavos;
        if (pointsAmount > subtotal - discount) throw new Error(`${pointsUsed} points (${peso(pointsAmount)}) is more than the order (${peso(subtotal - discount)}). Use fewer points.`);
      }
      // Orders with a special customer discount earn no points.
      const earnsPoints = !internal && !preApproved && !items.some((x) => x.specialUsed);
      const total = subtotal - discount - pointsAmount;

      if (amountPaid < 0) throw new Error('Amount paid cannot be negative.');
      if (amountPaid > total) throw new Error(`Amount paid is more than the order total (${peso(total)}). Record only the amount applied to this order.`);
      if (terms === 'FULL' && amountPaid !== total) throw new Error(`Full payment terms: amount paid must be ${peso(total)}.`);
      if (terms === 'DOWNPAYMENT' && amountPaid <= 0 && total > 0) throw new Error('Downpayment terms: enter the downpayment amount.');
      let method: PaymentMethod | null = null;
      if (amountPaid > 0) {
        if (!isKey<PaymentMethod>(PAYMENT_METHOD, input.method)) throw new Error('Choose the payment method.');
        method = input.method;
      }

      const orderNo = await nextNumber(tx, 'PP');
      const order = await tx.order.create({
        data: {
          orderNo, customerId, status: 'PENDING', paymentTerms: terms, subtotal, discount,
          discountReason: discount > 0 ? reason : null, discountApprovedById: approver?.id ?? null, total, balance: total,
          pointsUsed, pointsAmount, earnsPoints,
          targetDate, notes, createdById: user.id,
        },
      });

      if (pointsUsed > 0) await redeemOnOrder(tx, customerId, order.id, orderNo, pointsUsed, user.id);

      let jobs = 0;
      for (const it of items) {
        const item = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: it.product.id,
            description: it.product.name,
            quantity: it.quantity,
            widthFt: it.widthFt,
            heightFt: it.heightFt,
            suggestedUnitPrice: it.suggested,
            unitPrice: it.unitPrice,
            lineTotal: it.lineTotal,
            priceOverrideReason: it.overrideReason,
            specsNotes: it.specsNotes,
            fileSource: it.fileSource,
            fileSourceNote: it.fileSourceNote,
            specs: { create: it.specs.map((s) => ({ ...s })) },
          },
        });
        if (it.product.requiresProduction) {
          const job = await tx.job.create({ data: { orderId: order.id, orderItemId: item.id, status: 'PENDING', dueDate: targetDate } });
          await tx.jobStatusLog.create({ data: { jobId: job.id, fromStatus: null, toStatus: 'PENDING', note: `Created from order ${orderNo}`, userId: user.id } });
          jobs++;
        } else {
          // No production job for this category (e.g. photo printing): materials leave stock at sale time.
          await deductBomForOrderItem(tx, item.id, user.id);
        }
        if (it.overrideReason) {
          await audit(tx, user.id, 'OVERRIDE', 'OrderItem', item.id,
            `${orderNo}: ${it.product.name} price changed ${peso(it.suggested)} → ${peso(it.unitPrice)} (${it.overrideReason})`,
            { orderId: order.id, suggested: it.suggested, unitPrice: it.unitPrice, reason: it.overrideReason });
        }
      }

      let receiptNo: string | null = null;
      if (amountPaid > 0 && method) {
        const accountId = await resolvePaymentAccount(tx, method, input.accountId ?? null);
        receiptNo = await nextNumber(tx, 'AR');
        const p = await tx.payment.create({
          data: { receiptNo, orderId: order.id, customerId, amount: amountPaid, method, reference, accountId, receivedById: user.id, notes: 'Paid at order creation' },
        });
        await audit(tx, user.id, 'CREATE', 'Payment', p.id, `${receiptNo}: ${peso(amountPaid)} ${PAYMENT_METHOD[method]} for ${orderNo}`,
          { orderId: order.id, amount: amountPaid, method, reference });
        await earnForPayment(tx, p.id, user.id, pts);
      }

      await recalcOrder(tx, order.id);
      await audit(tx, user.id, 'CREATE', 'Order', order.id, `Created order ${orderNo} for ${customer.name} — ${peso(total)}`, {
        customerId, subtotal, discount, pointsUsed, pointsAmount, earnsPoints, discountReason: reason, discountApprovedBy: approver?.name ?? (preApproved ? 'special customer discount' : null), total, paymentTerms: terms, amountPaid, receiptNo, jobs,
        items: items.map((x) => ({ productId: x.product.id, name: x.product.name, qty: x.quantity, unitPrice: x.unitPrice, suggested: x.suggested })),
      });
      return order;
    });

    revalidateOrder(order.id);
    revalidatePath('/jobs');
    return { id: order.id, ok: `Order ${order.orderNo} saved.` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

// ───────── order page actions (ActionForm) ─────────

export async function addPayment(orderId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('orders');
    const amount = toCentavos(fd.get('amount'));
    if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
    const method = str(fd, 'method');
    if (!isKey<PaymentMethod>(PAYMENT_METHOD, method)) throw new Error('Choose the payment method.');
    const reference = optStr(fd, 'reference');
    const notes = optStr(fd, 'notes');
    let receiptNo = '';
    let earned = 0;
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: { select: { isInternal: true, name: true } } } });
      if (order.status === 'CANCELLED') throw new Error('This order is cancelled.');
      if (order.customer.isInternal) throw new Error(`${order.customer.name} is a branch of the shop — transfers are not paid for.`);
      if (amount > order.balance) throw new Error(`Amount is more than the balance (${peso(order.balance)}).`);
      const accountId = await resolvePaymentAccount(tx, method, optInt(fd, 'accountId'));
      receiptNo = await nextNumber(tx, 'AR');
      const p = await tx.payment.create({
        data: { receiptNo, orderId, customerId: order.customerId, amount, method, reference, notes, accountId, receivedById: user.id },
      });
      await recalcOrder(tx, orderId);
      await audit(tx, user.id, 'CREATE', 'Payment', p.id, `${receiptNo}: ${peso(amount)} ${PAYMENT_METHOD[method]} for ${order.orderNo}`,
        { orderId, amount, method, accountId, reference, notes });
      earned = await earnForPayment(tx, p.id, user.id);
    });
    revalidateOrder(orderId);
    return { ok: `Payment recorded — receipt ${receiptNo}.${earned ? ` Customer earned ${earned} point${earned === 1 ? '' : 's'}.` : ''}` };
  });
}

export async function voidPayment(paymentId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let orderId = 0;
  const res = await attempt(async () => {
    // Cashiers may void too, but only with an owner/admin approval PIN.
    const user = await assertUser('orders');
    const reason = str(fd, 'reason');
    if (!reason) throw new Error('Enter the reason for voiding this payment.');
    await prisma.$transaction(async (tx) => {
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true } });
      orderId = p.orderId;
      if (p.voided) throw new Error('This payment is already void.');
      const approver = await verifyApprovalPin(tx, str(fd, 'approvalPin'), user.id, 'a void');
      await tx.payment.update({ where: { id: paymentId }, data: { voided: true, voidReason: reason, voidedAt: new Date(), voidedById: user.id, voidApprovedById: approver.id } });
      await recalcOrder(tx, p.orderId);
      await reverseForPayment(tx, paymentId, user.id);
      await audit(tx, user.id, 'VOID', 'Payment', paymentId, `Voided ${p.receiptNo} (${peso(p.amount)}) on ${p.order.orderNo}: ${reason} — approved by ${approver.name}`,
        { amount: p.amount, reason, approvedBy: approver.name });
    });
    return { ok: 'Payment voided.' };
  });
  if (orderId) revalidateOrder(orderId);
  return res;
}

export async function updateOrderHeader(orderId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('orders');
    const rawDate = str(fd, 'targetDate');
    const targetDate = rawDate ? parseDateInput(rawDate) : null;
    if (rawDate && !targetDate) throw new Error('Target date is invalid.');
    const terms = str(fd, 'paymentTerms');
    if (!isKey<PaymentTerms>(PAYMENT_TERMS, terms)) throw new Error('Choose the payment terms.');
    const discount = toCentavosOrZero(fd.get('discount'));
    if (!Number.isFinite(discount) || discount < 0) throw new Error('Discount is invalid.');
    const discountReason = optStr(fd, 'discountReason');
    const notes = optStr(fd, 'notes');

    await prisma.$transaction(async (tx) => {
      const before = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: { select: { specialDiscountPct: true } } } });
      if (before.status === 'CANCELLED') throw new Error('This order is cancelled.');
      if (discount > before.subtotal - before.pointsAmount) throw new Error('Discount cannot be more than the subtotal (after points used).');
      const preApproved = discount > 0 && discount <= specialDiscountAmount(before.customer.specialDiscountPct, before.subtotal);
      const reasonText = discountReason ?? (preApproved ? `Special customer discount (${before.customer.specialDiscountPct}%)` : null);
      if (discount > 0 && !reasonText) throw new Error('Enter a reason for the discount.');
      const total = before.subtotal - discount - before.pointsAmount;
      if (total < before.amountPaid) throw new Error(`The new total (${peso(total)}) is less than what was already paid (${peso(before.amountPaid)}). Void a payment first.`);
      // Adding or changing a discount needs an owner/admin password; removing one does not.
      const discountChanged = discount !== before.discount;
      const approver = discountChanged && discount > 0 && !preApproved
        ? await verifyApprovalPin(tx, str(fd, 'discountPin'), user.id, 'a discount')
        : null;
      const discountApprovedById = discount === 0 ? null : discountChanged ? approver?.id ?? null : before.discountApprovedById;

      const data = { targetDate, paymentTerms: terms, discount, discountReason: discount > 0 ? reasonText : null, discountApprovedById, total, notes };
      await tx.order.update({ where: { id: orderId }, data });
      if ((before.targetDate?.getTime() ?? null) !== (targetDate?.getTime() ?? null)) {
        await tx.job.updateMany({ where: { orderId, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, data: { dueDate: targetDate } });
      }
      await recalcOrder(tx, orderId);
      await audit(tx, user.id, 'UPDATE', 'Order', orderId, `Updated order ${before.orderNo}`, {
        before: { targetDate: before.targetDate?.toISOString() ?? null, paymentTerms: before.paymentTerms, discount: before.discount, discountReason: before.discountReason, total: before.total, notes: before.notes },
        after: { ...data, targetDate: targetDate?.toISOString() ?? null, discountApprovedBy: approver?.name ?? null },
      });
    });
    revalidateOrder(orderId);
    revalidatePath('/jobs');
    return { ok: 'Order updated.' };
  });
}

const MANUAL_STATUSES: OrderStatus[] = ['PENDING', 'IN_PRODUCTION', 'COMPLETED'];

export async function setOrderStatus(orderId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('orders');
    const status = str(fd, 'status') as OrderStatus;
    if (!MANUAL_STATUSES.includes(status)) throw new Error('Choose Pending, In Production or Completed.');
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status === 'CANCELLED') throw new Error('This order is cancelled.');
      if (order.status === 'DELIVERED') throw new Error('This order was already delivered / picked up.');
      if (order.status === status) return;
      await tx.order.update({ where: { id: orderId }, data: { status } });
      await audit(tx, user.id, 'STATUS', 'Order', orderId, `${order.orderNo}: ${ORDER_STATUS[order.status]} → ${ORDER_STATUS[status]} (manual)`);
    });
    revalidateOrder(orderId);
    return { ok: 'Status updated.' };
  });
}

export async function markDelivered(orderId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('orders');
    const reason = optStr(fd, 'overrideReason');
    await prisma.$transaction((tx) => markOrderDelivered(tx, orderId, user, reason));
    revalidateOrder(orderId);
    return { ok: 'Marked as Delivered / Picked up.' };
  });
}

export async function cancelOrder(orderId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('orders');
    const reason = str(fd, 'reason');
    if (!reason) throw new Error('Enter the reason for cancelling.');
    let paid = 0;
    let returned = 0;
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { jobs: true } });
      if (order.status === 'CANCELLED') throw new Error('This order is already cancelled.');
      if (order.status === 'DELIVERED') throw new Error('Delivered orders cannot be cancelled.');
      paid = order.amountPaid;
      await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
      const open = order.jobs.filter((j) => j.status !== 'COMPLETED' && j.status !== 'CANCELLED');
      for (const j of open) {
        await tx.job.update({ where: { id: j.id }, data: { status: 'CANCELLED' } });
        await tx.jobStatusLog.create({
          data: { jobId: j.id, fromStatus: j.status, toStatus: 'CANCELLED', note: `Order ${order.orderNo} cancelled: ${reason}`, userId: user.id },
        });
        if (j.materialsDeducted) returned += await returnJobMaterials(tx, j.id, user.id, `order ${order.orderNo} cancelled (${reason})`);
      }
      // Lines without a production job had their materials deducted when the order was made.
      returned += await returnOrderLineMaterials(tx, order.orderNo, user.id, `order ${order.orderNo} cancelled (${reason})`);
      await refundForOrder(tx, orderId, user.id);
      await recalcOrder(tx, orderId);
      const data: Prisma.InputJsonValue = { reason, total: order.total, amountPaid: order.amountPaid, jobsCancelled: open.map((j) => j.id), materialLinesReturned: returned };
      await audit(tx, user.id, 'CANCEL', 'Order', orderId, `Cancelled order ${order.orderNo}: ${reason}`, data);
    });
    revalidateOrder(orderId);
    revalidatePath('/jobs');
    revalidatePath('/inventory');
    const stock = returned > 0 ? ` Materials already used for it (${returned} line${returned === 1 ? '' : 's'}) were returned to stock.` : '';
    return {
      ok: paid > 0
        ? `Order cancelled.${stock} ${peso(paid)} was paid on this order — void the payments or refund the customer separately.`
        : `Order cancelled.${stock}`,
    };
  });
}
