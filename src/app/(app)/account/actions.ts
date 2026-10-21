'use server';

import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { hashApprovalPin, isValidPin } from '@/lib/approval';
import { revalidatePath } from 'next/cache';

export async function changePassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser();
    const current = str(fd, 'current');
    const next = str(fd, 'next');
    if (next.length < 6) return { error: 'New password must be at least 6 characters.' };
    if (next !== str(fd, 'confirm')) return { error: 'New passwords do not match.' };
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await bcrypt.compare(current, row.passwordHash))) return { error: 'Current password is wrong.' };
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
    await audit(prisma, user.id, 'UPDATE', 'User', user.id, 'Changed own password');
    return { ok: 'Password changed.' };
  });
}

/** ADMIN: set or change your own approval PIN (used to approve voids and discounts). */
export async function setApprovalPin(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('admin');
    const pin = str(fd, 'pin');
    if (!isValidPin(pin)) return { error: 'Use 4–8 digits, not all the same digit (e.g. not 0000).' };
    if (pin !== str(fd, 'confirmPin')) return { error: 'The two PINs do not match.' };
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await bcrypt.compare(str(fd, 'password'), row.passwordHash))) return { error: 'Your login password is wrong.' };
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { approvalPinHash: await hashApprovalPin(pin) } });
      await audit(tx, user.id, row.approvalPinHash ? 'UPDATE' : 'CREATE', 'User', user.id, `${row.approvalPinHash ? 'Changed' : 'Set'} approval PIN`);
    });
    revalidatePath('/account');
    return { ok: 'Approval PIN saved. Use it to approve voids and discounts.' };
  });
}
