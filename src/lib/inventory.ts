import type { MovementType } from '@prisma/client';
import type { Tx } from './db';
import { round3 } from './money';
import { audit } from './audit';

type MoveInput = {
  materialId: number;
  quantity: number; // signed
  type: MovementType;
  userId: number;
  unitCost?: number; // centavos; for stock-in updates the weighted-average cost
  notes?: string | null;
  jobId?: number | null;
  purchaseOrderId?: number | null;
  conversionId?: number | null;
  releasedToId?: number | null; // stock-out: worker who received the material
};

/** The single place that changes material stock. Always records a StockMovement. */
export async function moveStock(tx: Tx, m: MoveInput) {
  const mat = await tx.material.findUniqueOrThrow({ where: { id: m.materialId } });
  const qty = round3(m.quantity);
  if (qty === 0) return null;
  const newStock = round3(mat.stock + qty);

  let newCost = mat.unitCost;
  const incomingWithCost = qty > 0 && m.unitCost != null && (m.type === 'STOCK_IN' || m.type === 'CONVERSION_IN');
  if (incomingWithCost) {
    const oldQty = Math.max(0, mat.stock);
    newCost = oldQty + qty > 0 ? Math.round(((oldQty * mat.unitCost + qty * m.unitCost!) / (oldQty + qty)) * 10_000) / 10_000 : m.unitCost!;
  }

  await tx.material.update({ where: { id: mat.id }, data: { stock: newStock, unitCost: newCost } });
  return tx.stockMovement.create({
    data: {
      materialId: mat.id,
      type: m.type,
      quantity: qty,
      unitCost: incomingWithCost ? m.unitCost! : mat.unitCost,
      balanceAfter: newStock,
      notes: m.notes ?? null,
      jobId: m.jobId ?? null,
      purchaseOrderId: m.purchaseOrderId ?? null,
      conversionId: m.conversionId ?? null,
      releasedToId: m.releasedToId ?? null,
      userId: m.userId,
    },
  });
}

/**
 * Deduct the bill of materials for a job (once). Called when a job reaches the status set in
 * settings ("bom_deduct_on": IN_PROCESS or COMPLETED). Stock may go negative — the shop keeps
 * working and the low-stock alert shows it.
 */
export async function deductBomForJob(tx: Tx, jobId: number, userId: number) {
  const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
  if (job.materialsDeducted) return;
  await deductBomForOrderItem(tx, job.orderItemId, userId, jobId);
  await tx.job.update({ where: { id: jobId }, data: { materialsDeducted: true } });
}

/**
 * Deduct the bill of materials for one order line. Used by deductBomForJob, and directly at
 * order creation for lines that have no job (categories that don't require production,
 * e.g. Photo Printing), so their paper/ink still leaves stock.
 */
export async function deductBomForOrderItem(tx: Tx, orderItemId: number, userId: number, jobId: number | null = null) {
  const item = await tx.orderItem.findUniqueOrThrow({
    where: { id: orderItemId },
    include: { order: true, specs: true, product: { include: { bom: true } } },
  });
  const area = item.product.pricingMode === 'PER_SQFT' ? (item.widthFt ?? 0) * (item.heightFt ?? 0) : 1;

  for (const line of item.product.bom) {
    if (line.optionValueId && !item.specs.some((s) => s.optionValueId === line.optionValueId)) continue;
    if (line.optionValue2Id && !item.specs.some((s) => s.optionValueId === line.optionValue2Id)) continue;
    let multiplier = 1;
    if (line.optionId) {
      const spec = item.specs.find((s) => s.optionId === line.optionId && s.numberValue != null);
      if (!spec) continue;
      multiplier = spec.numberValue!;
    }
    const qty = round3(line.quantity * item.quantity * (line.perPiece ? 1 : area) * multiplier);
    if (qty <= 0) continue;
    await moveStock(tx, {
      materialId: line.materialId,
      quantity: -qty,
      type: 'JOB_DEDUCT',
      userId,
      jobId,
      notes: `${item.order.orderNo} · ${item.description}`,
    });
  }
}

/**
 * Put materials back in stock after a cancellation: every not-yet-returned JOB_DEDUCT movement
 * matching `where` gets an equal positive ADJUSTMENT (same job, current unit cost) and is marked returnedAt.
 * Returns the number of material lines returned.
 */
async function returnDeductions(tx: Tx, where: { jobId: number } | { jobId: null; notes: { startsWith: string } }, userId: number, reason: string) {
  const moves = await tx.stockMovement.findMany({ where: { ...where, type: 'JOB_DEDUCT', returnedAt: null }, orderBy: { id: 'asc' } });
  const now = new Date();
  for (const m of moves) {
    await moveStock(tx, { materialId: m.materialId, quantity: -m.quantity, type: 'ADJUSTMENT', userId, jobId: m.jobId, notes: `Returned to stock — ${reason}` });
    await tx.stockMovement.update({ where: { id: m.id }, data: { returnedAt: now } });
  }
  return moves.length;
}

/** A job was cancelled: return whatever its bill of materials took from stock. */
export async function returnJobMaterials(tx: Tx, jobId: number, userId: number, reason: string) {
  const n = await returnDeductions(tx, { jobId }, userId, reason);
  await tx.job.update({ where: { id: jobId }, data: { materialsDeducted: false } });
  return n;
}

/** An order was cancelled: return materials taken at order creation by lines without a production job. */
export async function returnOrderLineMaterials(tx: Tx, orderNo: string, userId: number, reason: string) {
  return returnDeductions(tx, { jobId: null, notes: { startsWith: `${orderNo} · ` } }, userId, reason);
}

/** Cut/convert raw-raw stock into raw stock. Output cost = input value / output qty. */
export async function convertMaterial(
  tx: Tx,
  c: { inputMaterialId: number; inputQty: number; outputMaterialId: number; outputQty: number; wasteQty: number; notes: string | null; userId: number },
) {
  if (c.inputMaterialId === c.outputMaterialId) throw new Error('Input and output materials must be different.');
  if (!(c.inputQty > 0) || !(c.outputQty > 0)) throw new Error('Quantities must be greater than zero.');
  const input = await tx.material.findUniqueOrThrow({ where: { id: c.inputMaterialId } });
  if (input.stock < c.inputQty) throw new Error(`Not enough ${input.name} in stock (have ${round3(input.stock)} ${input.unit}).`);
  const output = await tx.material.findUniqueOrThrow({ where: { id: c.outputMaterialId } });

  const conv = await tx.materialConversion.create({
    data: {
      inputMaterialId: input.id, inputQty: round3(c.inputQty), outputMaterialId: output.id,
      outputQty: round3(c.outputQty), wasteQty: round3(c.wasteQty || 0), notes: c.notes, userId: c.userId,
    },
  });
  const note = `${round3(c.inputQty)} ${input.unit} ${input.name} → ${round3(c.outputQty)} ${output.unit} ${output.name}`;
  await moveStock(tx, { materialId: input.id, quantity: -c.inputQty, type: 'CONVERSION_OUT', userId: c.userId, conversionId: conv.id, notes: note });
  const outputUnitCost = Math.round(((c.inputQty * input.unitCost) / c.outputQty) * 10_000) / 10_000;
  await moveStock(tx, { materialId: output.id, quantity: c.outputQty, type: 'CONVERSION_IN', unitCost: outputUnitCost, userId: c.userId, conversionId: conv.id, notes: note });
  await audit(tx, c.userId, 'CREATE', 'MaterialConversion', conv.id, note);
  return conv;
}

/** Receive (part of) a purchase order: adds stock at the PO unit cost and updates PO status. */
export async function receivePurchaseOrder(tx: Tx, poId: number, receipts: { itemId: number; qty: number }[], userId: number) {
  const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: { include: { material: true } } } });
  if (po.status === 'CANCELLED' || po.status === 'RECEIVED') throw new Error(`This PO is already ${po.status.toLowerCase()}.`);
  let any = false;
  for (const r of receipts) {
    const item = po.items.find((i) => i.id === r.itemId);
    if (!item || !(r.qty > 0)) continue;
    any = true;
    await moveStock(tx, {
      materialId: item.materialId, quantity: r.qty, type: 'STOCK_IN', unitCost: item.unitCost,
      userId, purchaseOrderId: po.id, notes: `Received from ${po.poNo}`,
    });
    await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: round3(item.receivedQty + r.qty) } });
  }
  if (!any) throw new Error('Enter at least one quantity to receive.');
  const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
  const complete = items.every((i) => i.receivedQty >= i.quantity);
  await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
  await audit(tx, userId, 'RECEIVE', 'PurchaseOrder', po.id, `Received items on ${po.poNo}`, receipts);
}
