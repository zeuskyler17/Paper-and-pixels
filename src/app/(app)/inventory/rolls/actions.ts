'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { moveStock } from '@/lib/inventory';
import { round3 } from '@/lib/money';

const refresh = (id: number) => { revalidatePath('/inventory/rolls'); revalidatePath('/inventory'); revalidatePath(`/inventory/${id}`); };

/** A new roll (or several) loaded: adds roll length × count metres at the roll's current cost per metre. */
export async function loadRolls(materialId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('inventory');
    const rolls = Number(str(fd, 'rolls'));
    if (!(rolls > 0) || rolls > 50) throw new Error('Enter how many rolls (1–50).');
    const note = optStr(fd, 'notes');
    const r = await prisma.$transaction(async (tx) => {
      const m = await tx.material.findUniqueOrThrow({ where: { id: materialId } });
      if (!m.rollLengthM) throw new Error('Set the length of one roll on the material first.');
      const perRoll = m.unit === 'cm' ? m.rollLengthM * 100 : m.rollLengthM; // roll length in the material's unit
      const metres = round3(rolls * perRoll);
      await moveStock(tx, { materialId, quantity: metres, type: 'STOCK_IN', unitCost: m.unitCost, userId: user.id, notes: `${rolls} roll(s) loaded (${perRoll} ${m.unit} each)${note ? ` · ${note}` : ''}` });
      await audit(tx, user.id, 'STOCK_IN', 'Material', materialId, `Loaded ${rolls} roll(s) of ${m.name} = ${metres} ${m.unit}`, { rolls, qty: metres, note });
      return { name: m.name, metres, unit: m.unit };
    });
    refresh(materialId);
    return { ok: `${rolls} roll(s) of ${r.name} added = ${r.metres} ${r.unit}.` };
  });
}

/**
 * A printed length taken from the roll outside an order (test print, reprint, waste):
 * stock goes down by the length printed. Orders deduct automatically through the product's materials list.
 */
export async function recordPrintedLength(materialId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('inventory');
    const value = Number(str(fd, 'length'));
    const unit = str(fd, 'unit');
    if (!(value > 0)) throw new Error('Enter the printed length.');
    const toM: Record<string, number> = { m: 1, cm: 0.01, in: 0.0254 };
    if (!(unit in toM)) throw new Error('Choose in, cm or m.');
    const reason = optStr(fd, 'notes');
    if (!reason) throw new Error('Say what was printed (e.g. "reprint 2 × 8x10 for PP-2026-00012" or "test print").');
    const r = await prisma.$transaction(async (tx) => {
      const m = await tx.material.findUniqueOrThrow({ where: { id: materialId } });
      const matUnitInM = m.unit === 'cm' ? 0.01 : m.unit === 'in' ? 0.0254 : 1;
      const qty = round3(value * toM[unit] / matUnitInM);
      if (!(qty > 0)) throw new Error('The length is too small to record.');
      await moveStock(tx, { materialId, quantity: -qty, type: 'STOCK_OUT', userId: user.id, notes: `Printed ${value} ${unit} (${qty} ${m.unit}) · ${reason}` });
      await audit(tx, user.id, 'STOCK_OUT', 'Material', materialId, `Printed ${value} ${unit} (${qty} ${m.unit}) of ${m.name}: ${reason}`, { value, unit, qty, reason });
      return { name: m.name, qty, unit: m.unit };
    });
    refresh(materialId);
    return { ok: `Recorded ${r.qty} ${r.unit} printed from ${r.name}.` };
  });
}
