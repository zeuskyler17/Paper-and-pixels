'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { PaymentMethod } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, optInt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { peso, toCentavos } from '@/lib/money';
import { parseDateInput, todayManila } from '@/lib/dates';
import { PAYMENT_METHOD } from '@/lib/labels';

function readSupplier(fd: FormData) {
  const name = str(fd, 'name');
  if (!name) throw new Error('Supplier name is required.');
  return {
    name,
    contactPerson: optStr(fd, 'contactPerson'),
    mobile: optStr(fd, 'mobile'),
    email: optStr(fd, 'email'),
    address: optStr(fd, 'address'),
    paymentTerms: optStr(fd, 'paymentTerms'),
    notes: optStr(fd, 'notes'),
    active: fd.get('active') === 'on' || fd.get('active') === '1',
  };
}

export async function createSupplier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await attempt(async () => {
    const user = await assertUser('purchasing');
    const data = readSupplier(fd);
    const s = await prisma.$transaction(async (tx) => {
      const s = await tx.supplier.create({ data });
      await audit(tx, user.id, 'CREATE', 'Supplier', s.id, `Created supplier ${s.name}`, data);
      return s;
    });
    id = s.id;
  });
  if (res?.error) return res;
  redirect(`/suppliers/${id}`);
}

export async function updateSupplier(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('purchasing');
    const data = readSupplier(fd);
    await prisma.$transaction(async (tx) => {
      const before = await tx.supplier.findUniqueOrThrow({ where: { id } });
      await tx.supplier.update({ where: { id }, data });
      await audit(tx, user.id, 'UPDATE', 'Supplier', id, `Updated supplier ${data.name}`, {
        before: { name: before.name, contactPerson: before.contactPerson, mobile: before.mobile, email: before.email, address: before.address, paymentTerms: before.paymentTerms, notes: before.notes, active: before.active },
        after: data,
      });
    });
    revalidatePath(`/suppliers/${id}`);
    revalidatePath('/suppliers');
    return { ok: 'Supplier saved.' };
  });
}

/** Record a payment to a supplier. Bound arg: supplierId. Optional PO via the `purchaseOrderId` field. */
export async function recordSupplierPayment(supplierId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('purchasing');
    const amount = toCentavos(fd.get('amount'));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
    const method = str(fd, 'method') as PaymentMethod;
    if (!(method in PAYMENT_METHOD)) throw new Error('Choose a payment method.');
    const dateStr = str(fd, 'paidAt') || todayManila();
    const day = parseDateInput(dateStr);
    if (!day) throw new Error('Invalid payment date.');
    // Today's payments keep the current time; back-dated ones are stored at noon Manila of that day.
    const paidAt = dateStr === todayManila() ? new Date() : new Date(day.getTime() + 12 * 3_600_000);
    const poId = optInt(fd, 'purchaseOrderId');

    let poNo: string | null = null;
    await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId } });
      if (poId) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
        if (!po || po.supplierId !== supplierId) throw new Error('That purchase order does not belong to this supplier.');
        if (po.status === 'CANCELLED') throw new Error('Cannot record a payment against a cancelled PO.');
        poNo = po.poNo;
      }
      const p = await tx.supplierPayment.create({
        data: {
          supplierId, purchaseOrderId: poId || null, amount, method, reference: optStr(fd, 'reference'),
          notes: optStr(fd, 'notes'), paidAt, createdById: user.id,
        },
      });
      await audit(tx, user.id, 'CREATE', 'SupplierPayment', p.id,
        `Paid ${peso(amount)} to ${supplier.name}${poNo ? ` for ${poNo}` : ''} (${PAYMENT_METHOD[method]})`,
        { supplierId, purchaseOrderId: poId, amount, method, reference: p.reference, paidAt: paidAt.toISOString() });
    });
    revalidatePath(`/suppliers/${supplierId}`);
    revalidatePath('/suppliers');
    if (poId) revalidatePath(`/purchase-orders/${poId}`);
    return { ok: `Payment of ${peso(amount)} recorded.` };
  });
}

/** ADMIN only. */
export async function voidSupplierPayment(paymentId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('admin');
    const reason = str(fd, 'reason');
    if (!reason) throw new Error('A reason is required to void a payment.');
    const p = await prisma.$transaction(async (tx) => {
      const p = await tx.supplierPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { supplier: true } });
      if (p.voided) throw new Error('This payment is already voided.');
      await tx.supplierPayment.update({ where: { id: paymentId }, data: { voided: true, voidReason: reason } });
      await audit(tx, user.id, 'VOID', 'SupplierPayment', paymentId, `Voided ${peso(p.amount)} payment to ${p.supplier.name}: ${reason}`, { reason, amount: p.amount });
      return p;
    });
    revalidatePath(`/suppliers/${p.supplierId}`);
    revalidatePath('/suppliers');
    if (p.purchaseOrderId) revalidatePath(`/purchase-orders/${p.purchaseOrderId}`);
    return { ok: 'Payment voided.' };
  });
}
