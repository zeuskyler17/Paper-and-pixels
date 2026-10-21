'use server';

import type { PaymentMethod } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { ACCOUNT_METHODS } from '@/lib/paymentAccounts';

function read(fd: FormData) {
  const method = str(fd, 'method') as PaymentMethod;
  if (!ACCOUNT_METHODS.includes(method)) throw new Error('Choose GCash, Maya, Bank transfer or Other.');
  const label = str(fd, 'label');
  if (!label) throw new Error('Enter a short name, e.g. "Jc\'s GCash" or "BDO Savings".');
  return { method, label, accountName: optStr(fd, 'accountName'), accountNumber: optStr(fd, 'accountNumber') };
}

export async function createPaymentAccount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('settings');
    const data = read(fd);
    await prisma.$transaction(async (tx) => {
      const a = await tx.paymentAccount.create({ data });
      await audit(tx, user.id, 'CREATE', 'PaymentAccount', a.id, `Added payment account ${a.label}`, data);
    });
    revalidatePath('/settings');
    return { ok: 'Account added.' };
  });
}

export async function updatePaymentAccount(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('settings');
    const data = { ...read(fd), active: fd.get('active') === 'on' };
    await prisma.$transaction(async (tx) => {
      const before = await tx.paymentAccount.findUniqueOrThrow({ where: { id } });
      await tx.paymentAccount.update({ where: { id }, data });
      await audit(tx, user.id, 'UPDATE', 'PaymentAccount', id, `Updated payment account ${data.label}${data.active ? '' : ' (hidden)'}`, { before, after: data });
    });
    revalidatePath('/settings');
    return { ok: 'Saved.' };
  });
}
