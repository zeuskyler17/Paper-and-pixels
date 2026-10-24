'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';

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

/** Owner/admin only: add or change this customer's special discount on a product (₱ deducted from each item). */
export async function saveCustomerPrice(customerId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('admin');
    const productId = Number(fd.get('productId'));
    const raw = String(fd.get('value') ?? '').trim().replace(/[₱,\s]/g, '');
    const value = Number(raw);
    if (!productId) throw new Error('Choose a product.');
    if (raw === '' || !Number.isFinite(value) || !(value > 0)) throw new Error('Enter the amount to deduct per item, e.g. 3 or 50.');
    const data = { amountOff: Math.round(value * 100) };
    await prisma.$transaction(async (tx) => {
      const [c, p] = await Promise.all([tx.customer.findUniqueOrThrow({ where: { id: customerId } }), tx.product.findUniqueOrThrow({ where: { id: productId } })]);
      await tx.customerPrice.upsert({
        where: { customerId_productId: { customerId, productId } },
        update: data,
        create: { customerId, productId, ...data, createdById: user.id },
      });
      await audit(tx, user.id, 'UPDATE', 'Customer', customerId, `Special discount for ${c.name}: ${p.name} — ₱${(data.amountOff / 100).toFixed(2)} off each`, { productId, ...data });
    });
    revalidatePath(`/customers/${customerId}`);
    revalidatePath('/customers');
    return { ok: 'Special discount saved. New orders for this customer deduct it automatically.' };
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
