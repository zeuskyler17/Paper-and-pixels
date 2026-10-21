// Pure price computation, shared by the POS screen (client) and the server (validation).

export type PricingOption = {
  id: number;
  name: string;
  type: 'SELECT' | 'MULTI' | 'NUMBER';
  required: boolean;
  unitPrice: number; // centavos per unit, NUMBER options
  minValue?: number | null;
  maxValue?: number | null;
  values: { id: number; label: string; priceDelta: number; active?: boolean }[];
};

export type PricingProduct = {
  id: number;
  name: string;
  pricingMode: 'FIXED' | 'PER_SQFT';
  basePrice: number; // centavos (per piece or per sq ft)
  options: PricingOption[];
};

/** optionId -> chosen value id (SELECT), value ids (MULTI), or number (NUMBER). */
export type Selection = Record<number, number | number[] | null | undefined>;

export type SpecSnapshot = {
  optionId: number;
  optionValueId: number | null;
  name: string;
  value: string;
  numberValue: number | null;
  priceEffect: number;
};

export type PriceResult = { unitPrice: number; specs: SpecSnapshot[]; errors: string[] };

export function computeUnitPrice(
  product: PricingProduct,
  selection: Selection,
  widthFt?: number | null,
  heightFt?: number | null,
): PriceResult {
  const errors: string[] = [];
  const specs: SpecSnapshot[] = [];
  let unit = product.basePrice;

  if (product.pricingMode === 'PER_SQFT') {
    const w = Number(widthFt), h = Number(heightFt);
    if (!(w > 0) || !(h > 0)) errors.push(`${product.name}: enter width and height in feet.`);
    unit = Math.round(product.basePrice * (w > 0 ? w : 0) * (h > 0 ? h : 0));
  }

  for (const opt of product.options) {
    const sel = selection[opt.id];
    if (opt.type === 'SELECT') {
      const v = opt.values.find((x) => x.id === sel && x.active !== false);
      if (!v) {
        if (opt.required) errors.push(`${product.name}: choose ${opt.name}.`);
        continue;
      }
      unit += v.priceDelta;
      specs.push({ optionId: opt.id, optionValueId: v.id, name: opt.name, value: v.label, numberValue: null, priceEffect: v.priceDelta });
    } else if (opt.type === 'MULTI') {
      const ids = Array.isArray(sel) ? sel : [];
      for (const id of ids) {
        const v = opt.values.find((x) => x.id === id && x.active !== false);
        if (!v) continue;
        unit += v.priceDelta;
        specs.push({ optionId: opt.id, optionValueId: v.id, name: opt.name, value: v.label, numberValue: null, priceEffect: v.priceDelta });
      }
      if (opt.required && ids.length === 0) errors.push(`${product.name}: choose at least one ${opt.name}.`);
    } else {
      const n = typeof sel === 'number' ? sel : NaN;
      if (!Number.isFinite(n)) {
        if (opt.required) errors.push(`${product.name}: enter ${opt.name}.`);
        continue;
      }
      if (opt.minValue != null && n < opt.minValue) errors.push(`${product.name}: ${opt.name} must be at least ${opt.minValue}.`);
      if (opt.maxValue != null && n > opt.maxValue) errors.push(`${product.name}: ${opt.name} must be at most ${opt.maxValue}.`);
      const effect = Math.round(n * opt.unitPrice);
      unit += effect;
      specs.push({ optionId: opt.id, optionValueId: null, name: opt.name, value: String(n), numberValue: n, priceEffect: effect });
    }
  }

  return { unitPrice: Math.max(0, unit), specs, errors };
}
