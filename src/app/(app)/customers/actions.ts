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
