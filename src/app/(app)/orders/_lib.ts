// Types and pure helpers shared by the POS client screen and the order server actions.
// No server-only imports here: this file is bundled into the client.
import type { PricingOption, PricingProduct, Selection } from '@/lib/pricing';

export type PosOption = PricingOption & { defaultValue: number | null };

export type PosProduct = Omit<PricingProduct, 'options'> & {
  categoryId: number;
  categoryName: string;
  requiresProduction: boolean;
  unit: string;
  description: string | null;
  options: PosOption[];
};

export type PosCustomer = { id: number; name: string; mobile: string | null; facebook: string | null; isInternal?: boolean };

export type OrderLineInput = {
  productId: number;
  /** optionId -> value id (SELECT), value ids (MULTI) or number (NUMBER) */
  selection: Record<string, number | number[] | null>;
  widthFt: number | null;
  heightFt: number | null;
  quantity: number;
  /** centavos; null = use the suggested price */
  unitPrice: number | null;
  overrideReason: string;
  specsNotes: string;
  fileSource: string;
  fileSourceNote: string;
};

export type CreateOrderInput = {
  customerId: number;
  lines: OrderLineInput[];
  targetDate: string; // YYYY-MM-DD
  notes: string;
  discount: number; // centavos
  discountReason: string;
  /** Owner/admin approval PIN for the discount (required when discount > 0). Never stored. */
  discountPin?: string;
  paymentTerms: string;
  amountPaid: number; // centavos
  method: string;
  /** Receiving GCash / Maya / bank account (required when such accounts are set up). */
  accountId?: number | null;
  reference: string;
};

export type JsonResult = { error?: string; ok?: string; id?: number };

/** Shape of a product loaded with category + options + values (Prisma include below). */
type ProductRow = {
  id: number;
  name: string;
  description: string | null;
  pricingMode: 'FIXED' | 'PER_SQFT';
  basePrice: number;
  unit: string;
  categoryId: number;
  category: { name: string; requiresProduction: boolean };
  options: {
    id: number; name: string; type: 'SELECT' | 'MULTI' | 'NUMBER'; required: boolean; unitPrice: number;
    minValue: number | null; maxValue: number | null; defaultValue: number | null;
    values: { id: number; label: string; priceDelta: number; active: boolean }[];
  }[];
};

export const POS_PRODUCT_INCLUDE = {
  category: true,
  options: {
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    include: { values: { orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] } },
  },
};

/** Map a DB product to the POS/pricing shape. Inactive option values are dropped (cannot be sold). */
export function toPosProduct(p: ProductRow): PosProduct {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    pricingMode: p.pricingMode,
    basePrice: p.basePrice,
    unit: p.unit,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    requiresProduction: p.category.requiresProduction,
    options: p.options.map((o) => ({
      id: o.id,
      name: o.name,
      type: o.type,
      required: o.required,
      unitPrice: o.unitPrice,
      minValue: o.minValue,
      maxValue: o.maxValue,
      defaultValue: o.defaultValue,
      values: o.values.filter((v) => v.active).map((v) => ({ id: v.id, label: v.label, priceDelta: v.priceDelta, active: true })),
    })),
  };
}

/**
 * Turn an untrusted selection (from JSON) into a pricing Selection, rejecting values that do not
 * belong to the product's active options. Returns the selection plus any errors.
 */
export function sanitizeSelection(product: PosProduct, raw: Record<string, unknown> | null | undefined): { selection: Selection; errors: string[] } {
  const selection: Selection = {};
  const errors: string[] = [];
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const opt of product.options) {
    const v = (src as Record<string, unknown>)[String(opt.id)];
    if (v === null || v === undefined || v === '') continue;
    if (opt.type === 'SELECT') {
      const id = Number(v);
      if (!opt.values.some((x) => x.id === id)) errors.push(`${product.name}: the chosen ${opt.name} is no longer available.`);
      else selection[opt.id] = id;
    } else if (opt.type === 'MULTI') {
      const ids = Array.isArray(v) ? v.map(Number) : [];
      const bad = ids.filter((id) => !opt.values.some((x) => x.id === id));
      if (bad.length) errors.push(`${product.name}: a chosen ${opt.name} is no longer available.`);
      selection[opt.id] = [...new Set(ids.filter((id) => !bad.includes(id)))];
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) errors.push(`${product.name}: ${opt.name} must be a number.`);
      else selection[opt.id] = n;
    }
  }
  return { selection, errors };
}
