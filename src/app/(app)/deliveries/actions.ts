'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { DeliveryMethod, DeliveryStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertUser, can } from '@/lib/auth';
import { attempt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { toCentavosOrZero } from '@/lib/money';
import { parseDateInput } from '@/lib/dates';
import { markOrderDelivered } from '@/lib/orders';
import { DELIVERY_METHOD, DELIVERY_STATUS } from '@/lib/labels';
import { NEXT_STATUSES } from './_lib';

function readDelivery(fd: FormData) {
  const method = str(fd, 'method');
  if (!(method in DELIVERY_METHOD)) throw new Error('Choose a delivery method.');
  const fee = toCentavosOrZero(fd.get('fee'));
  if (!Number.isFinite(fee) || fee < 0) throw new Error('Enter a valid delivery fee.');
  const rawDate = str(fd, 'scheduledDate');
  const scheduledDate = parseDateInput(rawDate);
  if (rawDate && !scheduledDate) throw new Error('Enter a valid scheduled date.');
  return {
    method: method as DeliveryMethod,
    recipient: optStr(fd, 'recipient'),
    contactNo: optStr(fd, 'contactNo'),
    address: optStr(fd, 'address'),
    rider: optStr(fd, 'rider'),
    trackingNo: optStr(fd, 'trackingNo'),
    fee,
    scheduledDate,
    notes: optStr(fd, 'notes'),
  };
}

export async function createDelivery(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await attempt(async () => {
    const user = await assertUser('deliveries');
    const orderId = Number(str(fd, 'orderId'));
    if (!Number.isInteger(orderId) || orderId <= 0) throw new Error('Choose an order.');
    const data = readDelivery(fd);
    if (data.method !== 'PICKUP' && !data.address) throw new Error('Enter the delivery address.');
    const d = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new Error('Order not found.');
      if (order.status === 'CANCELLED') throw new Error('This order was cancelled.');
      const d = await tx.delivery.create({ data: { ...data, orderId, createdById: user.id } });
      await audit(tx, user.id, 'CREATE', 'Delivery', d.id,
        `${DELIVERY_METHOD[data.method]} record for ${order.orderNo}`, { ...data, scheduledDate: data.scheduledDate?.toISOString() ?? null, orderId });
      return d;
    });
    id = d.id;
  });
  if (res?.error) return res;
  revalidatePath('/deliveries');
  redirect(`/deliveries/${id}`);
}

export async function updateDelivery(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('deliveries');
    const data = readDelivery(fd);
    if (data.method !== 'PICKUP' && !data.address) throw new Error('Enter the delivery address.');
    await prisma.$transaction(async (tx) => {
      const before = await tx.delivery.findUniqueOrThrow({ where: { id }, include: { order: { select: { orderNo: true } } } });
      if (before.status === 'DELIVERED' || before.status === 'CANCELLED') {
        throw new Error(`This record is already ${DELIVERY_STATUS[before.status].toLowerCase()} and can no longer be edited.`);
      }
      await tx.delivery.update({ where: { id }, data });
      const { order, ...beforeData } = before;
      await audit(tx, user.id, 'UPDATE', 'Delivery', id, `Updated delivery for ${order.orderNo}`,
        JSON.parse(JSON.stringify({ before: beforeData, after: data })));
    });
    revalidatePath(`/deliveries/${id}`);
    revalidatePath('/deliveries');
    return { ok: 'Delivery saved.' };
  });
}

export async function changeDeliveryStatus(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('deliveries');
    const to = str(fd, 'to') as DeliveryStatus;
    if (!(to in DELIVERY_STATUS)) throw new Error('Invalid status.');
    const reason = optStr(fd, 'reason');
    const overrideReason = can(user, 'orders_override') ? optStr(fd, 'overrideReason') : null;

    await prisma.$transaction(async (tx) => {
      const d = await tx.delivery.findUniqueOrThrow({ where: { id }, include: { order: { select: { orderNo: true } } } });
      if (!NEXT_STATUSES[d.status].includes(to)) {
        throw new Error(`Cannot change from ${DELIVERY_STATUS[d.status]} to ${DELIVERY_STATUS[to]}.`);
      }
      if (to === 'CANCELLED' && !reason) throw new Error('Enter a reason for cancelling.');

      const now = new Date();
      let notes = d.notes;
      if (to === 'CANCELLED') notes = [d.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n');
      await tx.delivery.update({
        where: { id },
        data: { status: to, deliveredAt: to === 'DELIVERED' ? now : null, notes },
      });
      // Delivered → the order is released too (fails if there is a balance, unless an admin overrides).
      if (to === 'DELIVERED') await markOrderDelivered(tx, d.orderId, user, overrideReason);
      await audit(tx, user.id, 'STATUS', 'Delivery', id,
        `${d.order.orderNo}: delivery ${DELIVERY_STATUS[d.status]} → ${DELIVERY_STATUS[to]}${reason ? ` (${reason})` : ''}`);
    });
    revalidatePath(`/deliveries/${id}`);
    revalidatePath('/deliveries');
    return { ok: `Marked ${DELIVERY_STATUS[to]}.` };
  });
}
