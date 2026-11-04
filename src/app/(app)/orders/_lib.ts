// Types and pure helpers shared by the POS client screen and the order server actions.
// No server-only imports here: this file is bundled into the client.
import { isTwoToneOption, joinCover, splitCover, type SpecialPrice, type PricingOption, type PricingProduct, type Selection } from '@/lib/pricing';

export type PosOption = PricingOption & { defaultValue: number | null };

export type PosProduct = Omit<PricingProduct, 'options'> & {
  categoryId: number;
  categoryName: string;
  requiresProduction: boolean;
  /** Lay Flat albums: the order line also creates a separate print job. */
  printJob: boolean;
  unit: string;
  description: string | null;
  options: PosOption[];
};

export type PosCustomer = {
  id: number; name: string; mobile: string | null; facebook: string | null; isInternal?: boolean; specialDiscountPct?: number | null;
  /** Owner-set special prices for this customer (fixed ₱ or % off per product). */
  specialPrices?: SpecialPrice[];
  /** Loyalty points balance. */
  points?: number;
  /** Unused advance payment (centavos) — offered as the "Advance payment" method. */
  advance?: number;
};

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
  /** Loyalty points the customer uses on this order (promo must be on). */
  pointsUsed?: number;
  paymentTerms: string;
  amountPaid: number; // centavos
  method: string;
  /** Receiving GCash / Maya / bank account (required when such accounts are set up). */
  accountId?: number | null;
  reference: string;
  /** Split payment: a second amount paid now by another method (e.g. half cash, half GCash). */
  split?: { amount: number; method: string; accountId?: number | null; reference: string } | null;
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
  printJob: boolean;
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
    printJob: p.printJob,
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
      // Cover: [first, second] tone ids (second may be 0 while the form's second dropdown is still blank) + the FC value id when ticked.
      const raw = (Array.isArray(v) ? v : [v]).map(Number).filter((id) => id > 0);
      if (raw.length === 0) continue;
      if (raw.some((id) => !opt.values.some((x) => x.id === id))) { errors.push(`${product.name}: the chosen ${opt.name} is no longer available.`); continue; }
      if (isTwoToneOption(opt)) {
        const { tones, fc } = splitCover(opt, raw);
        const t = tones.slice(0, 2);
        selection[opt.id] = joinCover(opt, t.length === 2 && t[0] === t[1] ? [t[0]] : t, fc);
      } else selection[opt.id] = raw[0];
    } else if (opt.type === 'MULTI') {
      const ids = Array.isArray(v) ? v.map(Number).filter((id) => id > 0) : []; // a blank add-on row on the form is 0
      const bad = ids.filter((id) => !opt.values.some((x) => x.id === id));
      if (bad.length) errors.push(`${product.name}: a chosen ${opt.name} is no longer available.`);
      selection[opt.id] = ids.filter((id) => !bad.includes(id)); // repeats allowed (2× Extra Leave)
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) errors.push(`${product.name}: ${opt.name} must be a number.`);
      else selection[opt.id] = n;
    }
  }
  return { selection, errors };
}
