'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { OptionType, PricingMode } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, optInt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { round3, toCentavosOrZero } from '@/lib/money';

const ADMIN_ONLY = 'products_edit' as const;

// ───────── form helpers ─────────

function money(fd: FormData, key: string, label: string, allowNegative = false): number {
  const v = toCentavosOrZero(fd.get(key));
  if (!Number.isFinite(v)) throw new Error(`${label} is not a valid amount.`);
  if (!allowNegative && v < 0) throw new Error(`${label} cannot be negative.`);
  return v;
}

function intOrNull(fd: FormData, key: string, label: string): number | null {
  const v = optInt(fd, key);
  if (v !== null && Number.isNaN(v)) throw new Error(`${label} must be a whole number.`);
  return v;
}

function intOrZero(fd: FormData, key: string): number {
  const v = optInt(fd, key);
  return v === null || Number.isNaN(v) ? 0 : v;
}

function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === 'on' || v === '1' || v === 'true';
}

function revalidateProduct(productId?: number) {
  revalidatePath('/products');
  if (productId) revalidatePath(`/products/${productId}`);
}

// ───────── categories ─────────

function readCategory(fd: FormData) {
  const name = str(fd, 'name');
  if (!name) throw new Error('Category name is required.');
  return { name, requiresProduction: bool(fd, 'requiresProduction'), sortOrder: intOrZero(fd, 'sortOrder') };
}

export async function createCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const data = readCategory(fd);
    await prisma.$transaction(async (tx) => {
      if (await tx.productCategory.findUnique({ where: { name: data.name } })) throw new Error('A category with that name already exists.');
      const c = await tx.productCategory.create({ data });
      await audit(tx, user.id, 'CREATE', 'ProductCategory', c.id, `Created product category ${c.name}`, data);
    });
    revalidateProduct();
    return { ok: 'Category added.' };
  });
}

export async function updateCategory(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const data = readCategory(fd);
    await prisma.$transaction(async (tx) => {
      const before = await tx.productCategory.findUniqueOrThrow({ where: { id } });
      const clash = await tx.productCategory.findUnique({ where: { name: data.name } });
      if (clash && clash.id !== id) throw new Error('A category with that name already exists.');
      await tx.productCategory.update({ where: { id }, data });
      await audit(tx, user.id, 'UPDATE', 'ProductCategory', id, `Updated product category ${data.name}`, { before, after: data });
    });
    revalidateProduct();
    return { ok: 'Category saved.' };
  });
}

// ───────── products ─────────

async function readProduct(fd: FormData) {
  const name = str(fd, 'name');
  if (!name) throw new Error('Product name is required.');
  const categoryId = Number(str(fd, 'categoryId'));
  if (!categoryId) throw new Error('Choose a category.');
  if (!(await prisma.productCategory.findUnique({ where: { id: categoryId } }))) throw new Error('Category not found.');
  const pricingMode = str(fd, 'pricingMode') as PricingMode;
  if (pricingMode !== 'FIXED' && pricingMode !== 'PER_SQFT') throw new Error('Choose a pricing mode.');
  return {
    categoryId,
    name,
    description: optStr(fd, 'description'),
    pricingMode,
    basePrice: money(fd, 'basePrice', 'Base price'),
    unit: str(fd, 'unit') || (pricingMode === 'PER_SQFT' ? 'sq ft' : 'pc'),
    active: bool(fd, 'active'),
  };
}

/** Quick base-price change from the Products & Pricing list. */
export async function updateBasePrice(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    if (String(fd.get('basePrice') ?? '').trim() === '') throw new Error('Enter a price.');
    const basePrice = money(fd, 'basePrice', 'Base price');
    const p = await prisma.$transaction(async (tx) => {
      const before = await tx.product.findUniqueOrThrow({ where: { id } });
      if (before.basePrice === basePrice) return before;
      const p = await tx.product.update({ where: { id }, data: { basePrice } });
      await audit(tx, user.id, 'UPDATE', 'Product', id, `Base price of ${p.name}: ${(before.basePrice / 100).toFixed(2)} → ${(basePrice / 100).toFixed(2)}`, { before: before.basePrice, after: basePrice });
      return p;
    });
    revalidateProduct(id);
    return { ok: `Saved ₱${(p.basePrice / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` };
  });
}

/** Copy every option, its choices / add-on prices and (optionally) the bill of materials from one product to another. */
async function copyOptionsTx(tx: Tx, fromId: number, toId: number, withBom: boolean) {
  const src = await tx.product.findUniqueOrThrow({
    where: { id: fromId },
    include: { options: { orderBy: { sortOrder: 'asc' }, include: { values: { orderBy: { sortOrder: 'asc' } } } }, bom: true },
  });
  const start = (await tx.productOption.aggregate({ where: { productId: toId }, _max: { sortOrder: true } }))._max.sortOrder ?? -1;
  const optMap = new Map<number, number>();
  const valMap = new Map<number, number>();
  for (const [i, o] of src.options.entries()) {
    const n = await tx.productOption.create({
      data: { productId: toId, name: o.name, type: o.type, required: o.required, unitPrice: o.unitPrice, minValue: o.minValue, maxValue: o.maxValue, defaultValue: o.defaultValue, sortOrder: start + 1 + i },
    });
    optMap.set(o.id, n.id);
    for (const v of o.values) {
      const nv = await tx.productOptionValue.create({ data: { optionId: n.id, label: v.label, priceDelta: v.priceDelta, sortOrder: v.sortOrder, active: v.active } });
      valMap.set(v.id, nv.id);
    }
  }
  let bomLines = 0;
  if (withBom) {
    for (const b of src.bom) {
      await tx.billOfMaterial.create({
        data: {
          productId: toId, materialId: b.materialId, quantity: b.quantity, perPiece: b.perPiece, notes: b.notes,
          optionId: b.optionId ? optMap.get(b.optionId) ?? null : null,
          optionValueId: b.optionValueId ? valMap.get(b.optionValueId) ?? null : null,
          optionValue2Id: b.optionValue2Id ? valMap.get(b.optionValue2Id) ?? null : null,
        },
      });
      bomLines++;
    }
  }
  return { from: src.name, options: src.options.length, values: valMap.size, bomLines };
}

export async function createProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const data = await readProduct(fd);
    const copyFrom = Number(str(fd, 'copyFromId')) || 0;
    const withBom = fd.get('copyBom') === 'on';
    const p = await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({ data });
      await audit(tx, user.id, 'CREATE', 'Product', p.id, `Created product ${p.name}`, data);
      if (copyFrom) {
        const c = await copyOptionsTx(tx, copyFrom, p.id, withBom);
        await audit(tx, user.id, 'UPDATE', 'Product', p.id, `Copied ${c.options} option(s), ${c.values} choice(s)${withBom ? ` and ${c.bomLines} material line(s)` : ''} from ${c.from}`, { copyFrom, withBom });
      }
      return p;
    });
    id = p.id;
  });
  if (res?.error) return res;
  revalidateProduct();
  redirect(`/products/${id}`);
}

export async function updateProduct(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const data = await readProduct(fd);
    await prisma.$transaction(async (tx) => {
      const before = await tx.product.findUniqueOrThrow({ where: { id } });
      await tx.product.update({ where: { id }, data });
      await audit(tx, user.id, 'UPDATE', 'Product', id, `Updated product ${data.name}`, { before, after: data });
    });
    revalidateProduct(id);
    return { ok: 'Product saved.' };
  });
}

export async function copyOptionsInto(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const from = Number(str(fd, 'copyFromId')) || 0;
    if (!from) throw new Error('Choose the product to copy from.');
    if (from === id) throw new Error('Choose a different product.');
    const withBom = fd.get('copyBom') === 'on';
    const c = await prisma.$transaction(async (tx) => {
      const c = await copyOptionsTx(tx, from, id, withBom);
      await audit(tx, user.id, 'UPDATE', 'Product', id, `Copied ${c.options} option(s), ${c.values} choice(s)${withBom ? ` and ${c.bomLines} material line(s)` : ''} from ${c.from}`, { copyFrom: from, withBom });
      return c;
    });
    revalidateProduct(id);
    return { ok: `Copied ${c.options} option(s) with ${c.values} choice(s)${withBom ? ` and ${c.bomLines} material line(s)` : ''} from ${c.from}. Edit any price below.` };
  });
}

// ───────── options ─────────

function readOption(fd: FormData) {
  const name = str(fd, 'name');
  if (!name) throw new Error('Option name is required.');
  const type = str(fd, 'type') as OptionType;
  if (!['SELECT', 'MULTI', 'NUMBER'].includes(type)) throw new Error('Choose an option type.');
  const minValue = intOrNull(fd, 'minValue', 'Minimum');
  const maxValue = intOrNull(fd, 'maxValue', 'Maximum');
  const defaultValue = intOrNull(fd, 'defaultValue', 'Default');
  if (minValue !== null && maxValue !== null && minValue > maxValue) throw new Error('Minimum cannot be greater than maximum.');
  const isNumber = type === 'NUMBER';
  return {
    name,
    type,
    required: bool(fd, 'required'),
    unitPrice: isNumber ? money(fd, 'unitPrice', 'Price per unit') : 0,
    minValue: isNumber ? minValue : null,
    maxValue: isNumber ? maxValue : null,
    defaultValue: isNumber ? defaultValue : null,
    sortOrder: intOrZero(fd, 'sortOrder'),
  };
}

export async function createOption(productId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const data = readOption(fd);
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      const o = await tx.productOption.create({ data: { ...data, productId } });
      await audit(tx, user.id, 'CREATE', 'ProductOption', o.id, `Added option "${o.name}" to ${product.name}`, data);
    });
    revalidateProduct(productId);
    return { ok: 'Option added.' };
  });
}

export async function updateOption(optionId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let productId = 0;
  const res = await attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const data = readOption(fd);
    await prisma.$transaction(async (tx) => {
      const before = await tx.productOption.findUniqueOrThrow({ where: { id: optionId }, include: { product: true } });
      productId = before.productId;
      if (before.type === 'NUMBER' && data.type !== 'NUMBER') {
        const used = await tx.billOfMaterial.count({ where: { optionId } });
        if (used > 0) throw new Error('This option is used as a "per unit" multiplier in the bill of materials. Remove those lines first.');
      }
      await tx.productOption.update({ where: { id: optionId }, data });
      const { product, ...b } = before;
      await audit(tx, user.id, 'UPDATE', 'ProductOption', optionId, `Updated option "${data.name}" of ${product.name}`, { before: b, after: data });
    });
    return { ok: 'Option saved.' };
  });
  revalidateProduct(productId);
  return res;
}

/**
 * Delete a product that was never sold (no order lines). Its options, add-on prices and bill of
 * materials go with it. Products with past orders cannot be deleted — untick Active instead.
 */
export async function deleteProduct(id: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const res = await attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    await prisma.$transaction(async (tx) => {
      const p = await tx.product.findUniqueOrThrow({ where: { id }, include: { _count: { select: { orderItems: true, options: true, bom: true } } } });
      if (p._count.orderItems > 0) throw new Error(`"${p.name}" has been sold ${p._count.orderItems} time(s), so it cannot be deleted — untick Active to hide it from the POS instead.`);
      await tx.product.delete({ where: { id } }); // options, values and BOM lines cascade
      await audit(tx, user.id, 'DELETE', 'Product', id, `Deleted product ${p.name} (${p._count.options} option(s), ${p._count.bom} BOM line(s))`, { name: p.name, categoryId: p.categoryId, basePrice: p.basePrice });
    });
  });
  if (res?.error) return res;
  revalidateProduct();
  redirect('/products');
}

export async function deleteOption(optionId: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  let productId = 0;
  const res = await attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    await prisma.$transaction(async (tx) => {
      const opt = await tx.productOption.findUniqueOrThrow({ where: { id: optionId }, include: { product: true, values: true } });
      productId = opt.productId;
      const bomUses = await tx.billOfMaterial.count({
        where: { OR: [{ optionId }, { optionValueId: { in: opt.values.map((v) => v.id) } }, { optionValue2Id: { in: opt.values.map((v) => v.id) } }] },
      });
      if (bomUses > 0) throw new Error('This option is used in the bill of materials. Remove or change those lines first.');
      // Old orders keep their own snapshot of names/values (order_item_specs), so this is safe.
      await tx.productOption.delete({ where: { id: optionId } });
      await audit(tx, user.id, 'DELETE', 'ProductOption', optionId, `Removed option "${opt.name}" from ${opt.product.name}`, {
        name: opt.name, type: opt.type, values: opt.values.map((v) => ({ label: v.label, priceDelta: v.priceDelta })),
      });
    });
    return { ok: 'Option removed.' };
  });
  revalidateProduct(productId);
  return res;
}

// ───────── option values ─────────

function readValue(fd: FormData) {
  const label = str(fd, 'label');
  if (!label) throw new Error('Value label is required.');
  return { label, priceDelta: money(fd, 'priceDelta', 'Price change', true), sortOrder: intOrZero(fd, 'sortOrder'), active: bool(fd, 'active') };
}

export async function createOptionValue(optionId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let productId = 0;
  const res = await attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const data = { ...readValue(fd), active: true };
    await prisma.$transaction(async (tx) => {
      const opt = await tx.productOption.findUniqueOrThrow({ where: { id: optionId }, include: { product: true } });
      productId = opt.productId;
      const v = await tx.productOptionValue.create({ data: { ...data, optionId } });
      await audit(tx, user.id, 'CREATE', 'ProductOptionValue', v.id, `Added "${v.label}" to ${opt.product.name} › ${opt.name}`, data);
    });
    return { ok: 'Value added.' };
  });
  revalidateProduct(productId);
  return res;
}

export async function updateOptionValue(valueId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let productId = 0;
  const res = await attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const data = readValue(fd);
    await prisma.$transaction(async (tx) => {
      const before = await tx.productOptionValue.findUniqueOrThrow({ where: { id: valueId }, include: { option: { include: { product: true } } } });
      productId = before.option.productId;
      await tx.productOptionValue.update({ where: { id: valueId }, data });
      const { option, ...b } = before;
      await audit(tx, user.id, 'UPDATE', 'ProductOptionValue', valueId, `Updated "${data.label}" of ${option.product.name} › ${option.name}`, { before: b, after: data });
    });
    return { ok: 'Saved.' };
  });
  revalidateProduct(productId);
  return res;
}

export async function deleteOptionValue(valueId: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  let productId = 0;
  const res = await attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    await prisma.$transaction(async (tx) => {
      const v = await tx.productOptionValue.findUniqueOrThrow({ where: { id: valueId }, include: { option: { include: { product: true } } } });
      productId = v.option.productId;
      const usedInOrders = await tx.orderItemSpec.count({ where: { optionValueId: valueId } });
      if (usedInOrders > 0) throw new Error('This value was used in past orders. Untick "Active" to hide it instead.');
      const usedInBom = await tx.billOfMaterial.count({ where: { OR: [{ optionValueId: valueId }, { optionValue2Id: valueId }] } });
      if (usedInBom > 0) throw new Error('This value is used in the bill of materials. Remove those lines first, or untick "Active".');
      await tx.productOptionValue.delete({ where: { id: valueId } });
      await audit(tx, user.id, 'DELETE', 'ProductOptionValue', valueId, `Removed "${v.label}" from ${v.option.product.name} › ${v.option.name}`, {
        label: v.label, priceDelta: v.priceDelta,
      });
    });
    return { ok: 'Value removed.' };
  });
  revalidateProduct(productId);
  return res;
}

// ───────── bill of materials ─────────

async function readBom(productId: number, fd: FormData) {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { pricingMode: true } });
  const materialId = Number(str(fd, 'materialId'));
  if (!materialId) throw new Error('Choose a material.');
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) throw new Error('Material not found.');
  // Quantity may be typed with a length unit ("18 cm", "14 in", "0.36 m") or with the unit picker;
  // it is converted to the material's own unit (rolls are kept in metres).
  const raw = str(fd, 'quantity').toLowerCase().replace(/,/g, '');
  const mm = /^\s*([0-9]*\.?[0-9]+)\s*(m|cm|mm|in|inch|inches|"|ft)?\s*$/.exec(raw);
  if (!mm) throw new Error('Quantity per unit must be a number, optionally with cm / in / m (e.g. "18 cm").');
  const typedUnit = (mm[2] ? mm[2].replace(/^(inch|inches|")$/, 'in') : str(fd, 'qtyUnit')) || material.unit;
  const toM: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };
  let quantity = Number(mm[1]);
  if (typedUnit !== material.unit) {
    if (!(typedUnit in toM) || !(material.unit in toM)) throw new Error(`"${typedUnit}" cannot be converted to this material's unit (${material.unit}). Enter the quantity in ${material.unit}.`);
    quantity = quantity * toM[typedUnit] / toM[material.unit];
  }
  quantity = round3(quantity);
  if (!(quantity > 0)) throw new Error(`Quantity per unit must be greater than zero (it came out as 0 ${material.unit} after conversion — use a smaller unit).`);

  const optionId = optInt(fd, 'optionId') || null;
  if (optionId) {
    const opt = await prisma.productOption.findUnique({ where: { id: optionId } });
    if (!opt || opt.productId !== productId || opt.type !== 'NUMBER') throw new Error('The "multiply by" option must be a number option of this product.');
  }
  const optionValueId = optInt(fd, 'optionValueId') || null;
  if (optionValueId) {
    const v = await prisma.productOptionValue.findUnique({ where: { id: optionValueId }, include: { option: true } });
    if (!v || v.option.productId !== productId) throw new Error('The "only when" value must belong to this product.');
  }
  const optionValue2Id = optInt(fd, 'optionValue2Id') || null;
  if (optionValue2Id) {
    if (optionValue2Id === optionValueId) throw new Error('The second "and only when" value is the same as the first.');
    const v = await prisma.productOptionValue.findUnique({ where: { id: optionValue2Id }, include: { option: true } });
    if (!v || v.option.productId !== productId) throw new Error('The "and only when" value must belong to this product.');
  }
  // perPiece only matters for per-square-foot products (e.g. 8 eyelets per tarpaulin regardless of size).
  const perPiece = product.pricingMode === 'PER_SQFT' && bool(fd, 'perPiece');
  return { materialId, quantity, optionId, optionValueId, optionValue2Id, perPiece, notes: optStr(fd, 'notes'), materialName: material.name };
}

export async function createBomLine(productId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const { materialName, ...data } = await readBom(productId, fd);
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      const line = await tx.billOfMaterial.create({ data: { ...data, productId } });
      await audit(tx, user.id, 'CREATE', 'BillOfMaterial', line.id, `Added ${materialName} to bill of materials of ${product.name}`, data);
    });
    revalidateProduct(productId);
    return { ok: 'Material line added.' };
  });
}

export async function updateBomLine(lineId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let productId = 0;
  const res = await attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    const line = await prisma.billOfMaterial.findUniqueOrThrow({ where: { id: lineId }, include: { product: true } });
    productId = line.productId;
    const { materialName, ...data } = await readBom(line.productId, fd);
    await prisma.$transaction(async (tx) => {
      await tx.billOfMaterial.update({ where: { id: lineId }, data });
      const { product, ...before } = line;
      await audit(tx, user.id, 'UPDATE', 'BillOfMaterial', lineId, `Updated ${materialName} in bill of materials of ${product.name}`, { before, after: data });
    });
    return { ok: 'Saved.' };
  });
  revalidateProduct(productId);
  return res;
}

export async function deleteBomLine(lineId: number, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  let productId = 0;
  const res = await attempt(async () => {
    const user = await assertUser(ADMIN_ONLY);
    await prisma.$transaction(async (tx) => {
      const line = await tx.billOfMaterial.findUniqueOrThrow({ where: { id: lineId }, include: { product: true, material: true } });
      productId = line.productId;
      await tx.billOfMaterial.delete({ where: { id: lineId } });
      await audit(tx, user.id, 'DELETE', 'BillOfMaterial', lineId, `Removed ${line.material.name} from bill of materials of ${line.product.name}`, {
        materialId: line.materialId, quantity: line.quantity, perPiece: line.perPiece, optionId: line.optionId, optionValueId: line.optionValueId, optionValue2Id: line.optionValue2Id, notes: line.notes,
      });
    });
    return { ok: 'Line removed.' };
  });
  revalidateProduct(productId);
  return res;
}
