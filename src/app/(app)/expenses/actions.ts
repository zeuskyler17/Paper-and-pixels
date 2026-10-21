'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { PaymentMethod } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { categoryLabel, isOtherCategory } from './_other';
import { peso, toCentavos } from '@/lib/money';
import { fmtDate, parseDateInput } from '@/lib/dates';
import { PAYMENT_METHOD } from '@/lib/labels';
import { saveUpload } from '@/lib/uploads';

// ───────────── Expenses ─────────────

export async function createExpense(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await attempt(async () => {
    const user = await assertUser('expenses');
    const date = parseDateInput(str(fd, 'date'));
    if (!date) throw new Error('Enter a valid date.');
    const categoryId = Number(str(fd, 'categoryId'));
    if (!categoryId) throw new Error('Choose a category.');
    const amount = toCentavos(str(fd, 'amount'));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
    const paidVia = str(fd, 'paidVia');
    if (!(paidVia in PAYMENT_METHOD)) throw new Error('Choose how it was paid.');
    const notes = optStr(fd, 'notes');

    await prisma.$transaction(async (tx) => {
      const category = await tx.expenseCategory.findUnique({ where: { id: categoryId } });
      if (!category || !category.active) throw new Error('That category is not available.');
      const otherDetail = isOtherCategory(category.name) ? optStr(fd, 'otherDetail') : null;
      if (isOtherCategory(category.name) && !otherDetail) throw new Error(`Please type what this ${category.name} expense is.`);
      const file = await saveUpload(tx, fd.get('receipt'), user.id);
      const e = await tx.expense.create({
        data: { date, categoryId, otherDetail, amount, paidVia: paidVia as PaymentMethod, notes, attachmentId: file?.id ?? null, createdById: user.id },
      });
      await audit(tx, user.id, 'CREATE', 'Expense', e.id,
        `Recorded ${categoryLabel(category.name, otherDetail)} expense ${peso(amount)} (${fmtDate(date)})`,
        { date: date.toISOString(), category: category.name, otherDetail, amount, paidVia, notes, attachmentId: file?.id ?? null });
    });
  });
  if (res?.error) return res;
  revalidatePath('/expenses');
  redirect('/expenses');
}

export async function voidExpense(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('expenses_manage');
    const reason = str(fd, 'reason');
    if (!reason) throw new Error('Enter a reason for voiding.');
    await prisma.$transaction(async (tx) => {
      const e = await tx.expense.findUniqueOrThrow({ where: { id }, include: { category: true } });
      if (e.voided) throw new Error('This expense is already voided.');
      await tx.expense.update({ where: { id }, data: { voided: true, voidReason: reason } });
      await audit(tx, user.id, 'VOID', 'Expense', id,
        `Voided ${e.category.name} expense ${peso(e.amount)} (${fmtDate(e.date)}): ${reason}`,
        { amount: e.amount, category: e.category.name, reason });
    });
    revalidatePath('/expenses');
    return { ok: 'Expense voided.' };
  });
}

// ───────────── Categories (admin) ─────────────

export async function createCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('expenses_manage');
    const name = str(fd, 'name');
    if (!name) throw new Error('Category name is required.');
    await prisma.$transaction(async (tx) => {
      const exists = await tx.expenseCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
      if (exists) throw new Error(`A category named "${exists.name}" already exists.`);
      const c = await tx.expenseCategory.create({ data: { name } });
      await audit(tx, user.id, 'CREATE', 'ExpenseCategory', c.id, `Created expense category ${name}`);
    });
    revalidatePath('/expenses/categories');
    return { ok: 'Category added.' };
  });
}

export async function updateCategory(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('expenses_manage');
    const name = str(fd, 'name');
    if (!name) throw new Error('Category name is required.');
    const active = fd.get('active') === 'on' || fd.get('active') === '1';
    await prisma.$transaction(async (tx) => {
      const before = await tx.expenseCategory.findUniqueOrThrow({ where: { id } });
      const clash = await tx.expenseCategory.findFirst({ where: { id: { not: id }, name: { equals: name, mode: 'insensitive' } } });
      if (clash) throw new Error(`A category named "${clash.name}" already exists.`);
      await tx.expenseCategory.update({ where: { id }, data: { name, active } });
      const changes: string[] = [];
      if (before.name !== name) changes.push(`renamed "${before.name}" → "${name}"`);
      if (before.active !== active) changes.push(active ? 'reactivated' : 'deactivated');
      await audit(tx, user.id, 'UPDATE', 'ExpenseCategory', id,
        `Expense category ${name}: ${changes.join(', ') || 'no changes'}`,
        { before: { name: before.name, active: before.active }, after: { name, active } });
    });
    revalidatePath('/expenses/categories');
    return { ok: 'Saved.' };
  });
}
