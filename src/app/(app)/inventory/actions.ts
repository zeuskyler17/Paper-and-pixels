'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { MaterialLevel, MaterialUse } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ASSIGNABLE_WORKER } from '@/lib/permissions';
import { assertUser } from '@/lib/auth';
import { attempt, num, optInt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { round3, toCentavos, toCentavosOrZero, fmtQty, toCentavosPrecise } from '@/lib/money';
import { convertMaterial, moveStock } from '@/lib/inventory';

const LEVELS: MaterialLevel[] = ['RAW_RAW', 'RAW', 'CONSUMABLE', 'GENERAL', 'FINISHED'];
const USES: MaterialUse[] = ['ALBUM', 'FRAME', 'PRINTING', 'GENERAL', 'SHARED'];

function readMaterial(fd: FormData) {
  const name = str(fd, 'name');
  if (!name) throw new Error('Material name is required.');
  const level = (str(fd, 'level') || 'CONSUMABLE') as MaterialLevel;
  if (!LEVELS.includes(level)) throw new Error('Choose a material level.');
  const usedFor = (str(fd, 'usedFor') || 'GENERAL') as MaterialUse;
  if (!USES.includes(usedFor)) throw new Error('Choose what this material is used for (Albums, Picture frames, Printing, General, Shared).');
  const unit = str(fd, 'unit');
  if (!unit) throw new Error('Unit is required (e.g. sheet, pc, roll, ml).');
  const reorder = str(fd, 'reorderLevel') === '' ? 0 : num(fd, 'reorderLevel');
  if (!Number.isFinite(reorder) || reorder < 0) throw new Error('Reorder level must be zero or more.');
  const unitCost = String(fd.get('unitCost') ?? '').trim() === '' ? 0 : toCentavosPrecise(fd.get('unitCost'));
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('Unit cost must be a valid amount.');
  const supplierId = optInt(fd, 'supplierId');
  const rollLengthM = str(fd, 'rollLengthM') ? Number(str(fd, 'rollLengthM')) || null : null;
  return {
    name,
    sku: optStr(fd, 'sku'),
    level,
    usedFor,
    unit,
    reorderLevel: round3(rollLengthM ? reorder * (unit === 'cm' ? rollLengthM * 100 : unit === 'in' ? rollLengthM / 0.0254 : rollLengthM) : reorder), // roll paper: entered in rolls
    unitCost,
    supplierId: supplierId && supplierId > 0 ? supplierId : null,
    notes: optStr(fd, 'notes'),
    active: fd.get('active') === 'on' || fd.get('active') === '1',
    rollWidthCm: str(fd, 'rollWidthCm') ? Number(str(fd, 'rollWidthCm')) || null : null,
    rollLengthM,
  };
}

function positiveQty(fd: FormData, key: string, label = 'Quantity'): number {
  const q = round3(num(fd, key));
  if (!Number.isFinite(q) || q <= 0) throw new Error(`${label} must be greater than zero.`);
  return q;
}

function revalidateMaterial(id: number) {
  revalidatePath(`/inventory/${id}`);
  revalidatePath('/inventory');
  revalidatePath('/inventory/movements');
}

export async function createMaterial(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await attempt(async () => {
    const user = await assertUser('inventory');
    const data = readMaterial(fd);
    const openingRaw = str(fd, 'openingStock');
    let opening = openingRaw === '' ? 0 : round3(Number(openingRaw));
    if (!Number.isFinite(opening) || opening < 0) throw new Error('Opening stock must be zero or more.');
    // Roll paper: the form takes cost per roll and opening stock in rolls; store per length unit.
    if (data.rollLengthM) {
      const rollLen = data.unit === 'cm' ? data.rollLengthM * 100 : data.unit === 'in' ? data.rollLengthM / 0.0254 : data.rollLengthM;
      data.unitCost = Math.round((data.unitCost / rollLen) * 10_000) / 10_000;
      opening = round3(opening * rollLen);
    }
    const m = await prisma.$transaction(async (tx) => {
      const m = await tx.material.create({ data: { ...data, stock: 0 } });
      if (opening > 0) {
        await moveStock(tx, {
          materialId: m.id, quantity: opening, type: 'ADJUSTMENT', unitCost: data.unitCost,
          userId: user.id, notes: 'Opening stock',
        });
      }
      await audit(tx, user.id, 'CREATE', 'Material', m.id, `Created material ${m.name}${opening > 0 ? ` (opening stock ${fmtQty(opening)} ${m.unit})` : ''}`, { ...data, openingStock: opening });
      return m;
    });
    id = m.id;
  });
  if (res?.error) return res;
  redirect(`/inventory/${id}`);
}

export async function updateMaterial(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('inventory');
    const data = readMaterial(fd);
    await prisma.$transaction(async (tx) => {
      const before = await tx.material.findUniqueOrThrow({ where: { id } });
      await tx.material.update({ where: { id }, data });
      await audit(tx, user.id, 'UPDATE', 'Material', id, `Updated material ${data.name}`, {
        before: { name: before.name, sku: before.sku, level: before.level, unit: before.unit, reorderLevel: before.reorderLevel, unitCost: before.unitCost, supplierId: before.supplierId, notes: before.notes, active: before.active },
        after: data,
      });
    });
    revalidateMaterial(id);
    return { ok: 'Material saved.' };
  });
}

export async function stockIn(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('inventory');
    const entered = positiveQty(fd, 'qty');
    const enteredCost = toCentavosPrecise(fd.get('unitCost'));
    if (!Number.isFinite(enteredCost) || enteredCost < 0) throw new Error('Enter the cost of this purchase.');
    const byRoll = str(fd, 'byRoll') === '1';
    const notes = optStr(fd, 'notes');
    const r = await prisma.$transaction(async (tx) => {
      const m = await tx.material.findUniqueOrThrow({ where: { id } });
      // Roll paper is bought by the roll: convert rolls → length and cost per roll → cost per unit.
      const rollLen = m.rollLengthM ? (m.unit === 'cm' ? m.rollLengthM * 100 : m.unit === 'in' ? m.rollLengthM / 0.0254 : m.rollLengthM) : 0;
      if (byRoll && !rollLen) throw new Error('Set the length of one roll on this material first.');
      const qty = byRoll ? round3(entered * rollLen) : entered;
      const unitCost = byRoll ? Math.round((enteredCost / rollLen) * 10_000) / 10_000 : enteredCost;
      const note = byRoll ? `${fmtQty(entered)} roll(s) × ${fmtQty(rollLen)} ${m.unit} at ₱${(enteredCost / 100).toLocaleString()} per roll${notes ? ` · ${notes}` : ''}` : (notes ?? 'Manual stock in');
      const mv = await moveStock(tx, { materialId: id, quantity: qty, type: 'STOCK_IN', unitCost, userId: user.id, notes: note });
      await audit(tx, user.id, 'STOCK_IN', 'Material', id, `Stock in ${byRoll ? `${fmtQty(entered)} roll(s) = ` : ''}${fmtQty(qty)} ${m.unit} ${m.name}`, { entered, byRoll, qty, unitCost, notes, movementId: mv?.id ?? null });
      return { qty, unit: m.unit };
    });
    revalidateMaterial(id);
    return { ok: byRoll ? `Added ${fmtQty(entered)} roll(s) = ${fmtQty(r.qty)} ${r.unit} to stock.` : `Added ${fmtQty(r.qty)} to stock.` };
  });
}

/**
 * Take material out of stock, optionally released to a production worker. Used by the material
 * page and the Stock Out page. Needs either a worker or a note (what it was used for / why wasted).
 */
async function doStockOut(materialId: number, fd: FormData): Promise<string> {
  const user = await assertUser('inventory');
  const qty = positiveQty(fd, 'qty');
  const notes = optStr(fd, 'notes');
  const releasedToId = optInt(fd, 'releasedToId');
  if (!releasedToId && !notes) throw new Error('Choose who received the material, or write what it was used for (e.g. damaged, sample).');
  let msg = '';
  await prisma.$transaction(async (tx) => {
    const m = await tx.material.findUnique({ where: { id: materialId } });
    if (!m || !m.active) throw new Error('Choose a material.');
    if (round3(m.stock - qty) < 0) throw new Error(`Not enough stock: only ${fmtQty(m.stock)} ${m.unit} of ${m.name} on hand.`);
    let worker: { id: number; name: string } | null = null;
    if (releasedToId) {
      worker = await tx.user.findFirst({ where: { id: releasedToId, ...ASSIGNABLE_WORKER }, select: { id: true, name: true } });
      if (!worker) throw new Error('Choose an active production worker.');
    }
    const mv = await moveStock(tx, {
      materialId, quantity: -qty, type: 'STOCK_OUT', userId: user.id, releasedToId: worker?.id ?? null,
      notes: notes ?? (worker ? `Released to ${worker.name}` : null),
    });
    const summary = `Stock out ${fmtQty(qty)} ${m.unit} ${m.name}${worker ? ` → ${worker.name}` : ''}`;
    await audit(tx, user.id, 'STOCK_OUT', 'Material', materialId, summary, { qty, notes, releasedToId: worker?.id ?? null, movementId: mv?.id ?? null });
    msg = `${summary}. ${fmtQty(round3(m.stock - qty))} ${m.unit} left.`;
  });
  revalidateMaterial(materialId);
  revalidatePath('/inventory/out');
  return msg;
}

export async function stockOut(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => ({ ok: await doStockOut(id, fd) }));
}

/** Stock Out page: the material is chosen in the form. */
export async function stockOutQuick(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const materialId = optInt(fd, 'materialId');
    if (!materialId) throw new Error('Choose a material.');
    return { ok: await doStockOut(materialId, fd) };
  });
}

export async function adjustStock(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('inventory');
    const counted = round3(num(fd, 'counted'));
    if (!Number.isFinite(counted) || counted < 0) throw new Error('Enter the counted quantity (zero or more).');
    const reason = optStr(fd, 'reason');
    if (!reason) throw new Error('A reason is required for adjustments.');
    let diff = 0;
    await prisma.$transaction(async (tx) => {
      const m = await tx.material.findUniqueOrThrow({ where: { id } });
      diff = round3(counted - m.stock);
      if (diff === 0) throw new Error(`The count matches the system stock (${fmtQty(m.stock)} ${m.unit}); nothing to adjust.`);
      const mv = await moveStock(tx, { materialId: id, quantity: diff, type: 'ADJUSTMENT', userId: user.id, notes: `Physical count ${fmtQty(counted)}: ${reason}` });
      await audit(tx, user.id, 'ADJUST', 'Material', id, `Adjusted ${m.name} from ${fmtQty(m.stock)} to ${fmtQty(counted)} ${m.unit}`, { before: m.stock, counted, diff, reason, movementId: mv?.id ?? null });
    });
    revalidateMaterial(id);
    return { ok: `Stock adjusted by ${diff > 0 ? '+' : ''}${fmtQty(diff)}.` };
  });
}

export async function convertStock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('inventory');
    const inputMaterialId = optInt(fd, 'inputMaterialId');
    const outputMaterialId = optInt(fd, 'outputMaterialId');
    if (!inputMaterialId) throw new Error('Choose the input material.');
    if (!outputMaterialId) throw new Error('Choose the output material.');
    const inputQty = positiveQty(fd, 'inputQty', 'Input quantity');
    const outputQty = positiveQty(fd, 'outputQty', 'Output quantity');
    const wasteRaw = str(fd, 'wasteQty');
    const wasteQty = wasteRaw === '' ? 0 : round3(Number(wasteRaw));
    if (!Number.isFinite(wasteQty) || wasteQty < 0) throw new Error('Waste must be zero or more.');
    const conv = await prisma.$transaction((tx) =>
      convertMaterial(tx, { inputMaterialId, inputQty, outputMaterialId, outputQty, wasteQty, notes: optStr(fd, 'notes'), userId: user.id }),
    );
    revalidateMaterial(inputMaterialId);
    revalidateMaterial(outputMaterialId);
    revalidatePath('/inventory/convert');
    return { ok: `Conversion #${conv.id} recorded.` };
  });
}
