'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, logActionError, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { nextNumber } from '@/lib/counters';
import { fmtQty, peso, round3, toCentavos } from '@/lib/money';
import { parseDateInput, todayManila } from '@/lib/dates';
import { receivePurchaseOrder } from '@/lib/inventory';

export type POPayload = {
  supplierId: number;
  orderDate: string; // YYYY-MM-DD
  expectedDate: string; // YYYY-MM-DD or ''
  notes: string;
  items: { materialId: number; quantity: number | string; unitCost: string }[]; // unitCost in pesos
};

export type POResult = { error?: string; ok?: string; id?: number };

function validate(p: POPayload) {
  const supplierId = Number(p.supplierId);
  if (!supplierId) throw new Error('Choose a supplier.');
  const orderDay = parseDateInput(p.orderDate || todayManila());
  if (!orderDay) throw new Error('Invalid order date.');
  const orderDate = (p.orderDate || todayManila()) === todayManila() ? new Date() : orderDay;
  let expectedDate: Date | null = null;
  if (p.expectedDate) {
    expectedDate = parseDateInput(p.expectedDate);
    if (!expectedDate) throw new Error('Invalid expected date.');
  }
  const items = (p.items ?? []).map((it, i) => {
    const materialId = Number(it.materialId);
    const quantity = round3(Number(it.quantity));
    const unitCost = toCentavos(it.unitCost);
    if (!materialId) throw new Error(`Line ${i + 1}: choose a material.`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Line ${i + 1}: quantity must be greater than zero.`);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error(`Line ${i + 1}: enter a valid unit cost.`);
    return { materialId, quantity, unitCost, lineTotal: Math.round(quantity * unitCost) };
  });
  if (items.length === 0) throw new Error('Add at least one item.');
  const total = items.reduce((s, i) => s + i.lineTotal, 0);
  const notes = (p.notes ?? '').trim() || null;
  return { supplierId, orderDate, expectedDate, notes, items, total };
}

async function wrap(fn: () => Promise<POResult>): Promise<POResult> {
  try {
    return await fn();
  } catch (e: unknown) {
    logActionError(e);
    return { error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
}

/** Create a PO (DRAFT). Called directly from the client form with a JSON payload. */
export async function createPurchaseOrder(payload: POPayload): Promise<POResult> {
  return wrap(async () => {
    const user = await assertUser('purchasing');
    const v = validate(payload);
    const po = await prisma.$transaction(async (tx) => {
      await tx.supplier.findUniqueOrThrow({ where: { id: v.supplierId } });
      const mats = await tx.material.count({ where: { id: { in: v.items.map((i) => i.materialId) } } });
      if (mats !== new Set(v.items.map((i) => i.materialId)).size) throw new Error('One of the materials no longer exists.');
      const poNo = await nextNumber(tx, 'PO');
      const po = await tx.purchaseOrder.create({
        data: {
          poNo, supplierId: v.supplierId, orderDate: v.orderDate, expectedDate: v.expectedDate, notes: v.notes,
          total: v.total, createdById: user.id, items: { create: v.items },
        },
      });
      await audit(tx, user.id, 'CREATE', 'PurchaseOrder', po.id, `Created ${poNo} (${peso(v.total)})`, {
        supplierId: v.supplierId, total: v.total, items: v.items,
      });
      return po;
    });
    revalidatePath('/purchase-orders');
    revalidatePath(`/suppliers/${v.supplierId}`);
    return { ok: 'Purchase order created.', id: po.id };
  });
}

/** Replace header + items of a DRAFT PO. */
export async function updatePurchaseOrder(id: number, payload: POPayload): Promise<POResult> {
  return wrap(async () => {
    const user = await assertUser('purchasing');
    const v = validate(payload);
    await prisma.$transaction(async (tx) => {
      const before = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
      if (before.status !== 'DRAFT') throw new Error('Only draft purchase orders can be edited.');
      await tx.supplier.findUniqueOrThrow({ where: { id: v.supplierId } });
      if (v.supplierId !== before.supplierId && (await tx.supplierPayment.count({ where: { purchaseOrderId: id } })) > 0) {
        throw new Error('Payments are already recorded against this PO, so the supplier cannot be changed.');
      }
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: v.supplierId, orderDate: v.orderDate, expectedDate: v.expectedDate, notes: v.notes, total: v.total,
          items: { create: v.items },
        },
      });
      await audit(tx, user.id, 'UPDATE', 'PurchaseOrder', id, `Edited ${before.poNo} (${peso(before.total)} → ${peso(v.total)})`, {
        before: { supplierId: before.supplierId, total: before.total, items: before.items.map((i) => ({ materialId: i.materialId, quantity: i.quantity, unitCost: i.unitCost })) },
        after: { supplierId: v.supplierId, total: v.total, items: v.items },
      });
    });
    revalidatePath(`/purchase-orders/${id}`);
    revalidatePath('/purchase-orders');
    return { ok: 'Purchase order saved.', id };
  });
}

async function setStatus(id: number, from: 'DRAFT' | 'SENT', to: 'DRAFT' | 'SENT') {
  const user = await assertUser('purchasing');
  await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
    if (po.status !== from) throw new Error(`This PO is no longer ${from.toLowerCase()}.`);
    if (to === 'SENT' && po.items.length === 0) throw new Error('Add items before sending.');
    if (to === 'DRAFT' && po.items.some((i) => i.receivedQty > 0)) throw new Error('Items were already received.');
    await tx.purchaseOrder.update({ where: { id }, data: { status: to } });
    await audit(tx, user.id, 'STATUS', 'PurchaseOrder', id, `${po.poNo}: ${from} → ${to}`);
  });
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath('/purchase-orders');
}

export async function markPOSent(id: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    await setStatus(id, 'DRAFT', 'SENT');
    return { ok: 'Marked as sent to supplier.' };
  });
}

export async function revertPOToDraft(id: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    await setStatus(id, 'SENT', 'DRAFT');
    return { ok: 'Moved back to draft.' };
  });
}

export async function cancelPurchaseOrder(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('purchasing');
    const reason = str(fd, 'reason');
    if (!reason) throw new Error('A reason is required to cancel.');
    const po = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
      if (po.status === 'CANCELLED') throw new Error('This PO is already cancelled.');
      if (po.items.some((i) => i.receivedQty > 0)) throw new Error('Items were already received on this PO, so it can no longer be cancelled.');
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
      await audit(tx, user.id, 'CANCEL', 'PurchaseOrder', id, `Cancelled ${po.poNo}: ${reason}`, { reason, previousStatus: po.status });
      return po;
    });
    revalidatePath(`/purchase-orders/${id}`);
    revalidatePath('/purchase-orders');
    revalidatePath(`/suppliers/${po.supplierId}`);
    return { ok: 'Purchase order cancelled.' };
  });
}

/** Receive form: fields `qty_<itemId>` hold the quantity received now. */
export async function receivePO(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('purchasing');
    let summary = '';
    const po = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: { include: { material: true } } } });
      if (po.status !== 'SENT' && po.status !== 'PARTIALLY_RECEIVED') {
        throw new Error(po.status === 'DRAFT' ? 'Mark the PO as sent before receiving items.' : `This PO is ${po.status.toLowerCase().replace('_', ' ')}.`);
      }
      const receipts: { itemId: number; qty: number }[] = [];
      for (const item of po.items) {
        const raw = str(fd, `qty_${item.id}`);
        if (raw === '') continue;
        const qty = round3(Number(raw));
        if (!Number.isFinite(qty) || qty < 0) throw new Error(`${item.material.name}: enter a valid quantity.`);
        if (qty === 0) continue;
        const remaining = round3(item.quantity - item.receivedQty);
        if (qty > remaining) throw new Error(`${item.material.name}: only ${fmtQty(remaining)} ${item.material.unit} left to receive.`);
        receipts.push({ itemId: item.id, qty });
      }
      if (receipts.length === 0) throw new Error('Enter at least one quantity to receive.');
      await receivePurchaseOrder(tx, po.id, receipts, user.id);
      summary = receipts.map((r) => {
        const it = po.items.find((i) => i.id === r.itemId)!;
        return `${fmtQty(r.qty)} ${it.material.unit} ${it.material.name}`;
      }).join(', ');
      return po;
    });
    revalidatePath(`/purchase-orders/${id}`);
    revalidatePath('/purchase-orders');
    revalidatePath('/inventory');
    revalidatePath(`/suppliers/${po.supplierId}`);
    return { ok: `Received: ${summary}. Stock updated.` };
  });
}
