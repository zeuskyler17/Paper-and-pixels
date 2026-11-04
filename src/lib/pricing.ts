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

/** optionId -> chosen value id (SELECT; a pair of ids = two tone cover), value ids (MULTI), or number (NUMBER). */
export type Selection = Record<number, number | number[] | null | undefined>;

/** Options that may be chosen in two tones (two cover materials on one album): the "Cover" dropdown. */
export const isTwoToneOption = (opt: { name: string; type: string }) => opt.type === 'SELECT' && /cover/i.test(opt.name);
export const TWO_TONE = '(two tone)';
export const FULL_COVER = 'FC (full cover)';
/** The "FC" value of a cover option: a yes/no flag (full cover) on top of the cover color, never a color itself. */
export const fullCoverValue = <V extends { label: string }>(opt: { values: V[] }) => opt.values.find((v) => coverFamily(v.label) === 'fc');
/**
 * Split a cover selection into its tone ids and the FC flag. Stored as a number (one tone), or an array of
 * [first, second?] tone ids with the FC value id appended last when full cover is ticked.
 */
export function splitCover(opt: { values: { id: number; label: string }[] }, sel: number | number[] | null | undefined): { tones: number[]; fc: boolean } {
  const fcId = fullCoverValue(opt)?.id;
  const ids = (Array.isArray(sel) ? sel : [typeof sel === 'number' ? sel : 0]);
  return { tones: ids.filter((x) => x !== fcId), fc: fcId != null && ids.includes(fcId) };
}
/** Rebuild the stored shape from tones (+ a blank 0 while the second dropdown is empty) and the FC flag. */
export function joinCover(opt: { values: { id: number; label: string }[] }, tones: number[], fc: boolean): number | number[] | null {
  const fcId = fullCoverValue(opt)?.id;
  const out = fc && fcId ? [...tones, fcId] : [...tones];
  if (out.length === 0 || (out.length === 1 && !out[0])) return null;
  return out.length === 1 ? out[0] : out;
}
/** Cover material by code: 1–25 = leather, H1–H18 = tela, FC = full cover, anything else (T1–T4…) = other. */
export function coverFamily(label: string): 'leather' | 'tela' | 'fc' | 'other' {
  const l = label.trim().toUpperCase();
  if (/^\d+$/.test(l)) return 'leather';
  if (/^H\d+$/.test(l)) return 'tela';
  if (l === 'FC') return 'fc';
  return 'other';
}
/** Two tone rules: leather and tela cannot be combined; everything else (T codes) goes with anything. FC is a flag, not a tone. */
export function canTwoTone(first: string, second: string): boolean {
  const a = coverFamily(first), b = coverFamily(second);
  if (a === 'fc' || b === 'fc') return false;
  return !((a === 'leather' && b === 'tela') || (a === 'tela' && b === 'leather'));
}
export const COVER_FAMILY_NAME: Record<string, string> = { leather: 'leather', tela: 'tela', fc: 'full cover', other: '' };

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
      // Cover: [first, second] tone ids (two tone = a second spec at no extra charge), plus the FC value id when full cover is ticked.
      const cover = isTwoToneOption(opt) ? splitCover(opt, sel) : { tones: Array.isArray(sel) ? sel : [sel ?? 0], fc: false };
      const [first, second] = cover.tones;
      const v = opt.values.find((x) => x.id === first && x.active !== false);
      if (!v) {
        if (opt.required) errors.push(`${product.name}: choose ${opt.name}${cover.fc ? ' (FC still needs a cover color)' : ''}.`);
        continue;
      }
      unit += v.priceDelta;
      specs.push({ optionId: opt.id, optionValueId: v.id, name: opt.name, value: v.label, numberValue: null, priceEffect: v.priceDelta });
      const v2 = isTwoToneOption(opt) && second && second !== v.id ? opt.values.find((x) => x.id === second && x.active !== false) : undefined;
      if (v2 && !canTwoTone(v.label, v2.label)) errors.push(`${product.name}: two tone cannot mix leather (1, 2, 3…) with tela (H1, H2, H3…) — ${v.label} and ${v2.label}.`);
      else if (v2) specs.push({ optionId: opt.id, optionValueId: v2.id, name: opt.name, value: `${v2.label} ${TWO_TONE}`, numberValue: null, priceEffect: 0 });
      const fcV = cover.fc ? fullCoverValue(opt) : undefined;
      if (fcV) {
        unit += fcV.priceDelta;
        specs.push({ optionId: opt.id, optionValueId: fcV.id, name: opt.name, value: FULL_COVER, numberValue: null, priceEffect: fcV.priceDelta });
      }
    } else if (opt.type === 'MULTI') {
      const ids = Array.isArray(sel) ? sel : []; // the same add-on may repeat (2× Extra Leave); blanks (0) from the order form are skipped
      let picked = 0;
      for (const id of ids) {
        const v = opt.values.find((x) => x.id === id && x.active !== false);
        if (!v) continue;
        picked++;
        unit += v.priceDelta;
        specs.push({ optionId: opt.id, optionValueId: v.id, name: opt.name, value: v.label, numberValue: null, priceEffect: v.priceDelta });
      }
      if (opt.required && picked === 0) errors.push(`${product.name}: choose at least one ${opt.name}.`);
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

/** Group specs of the same option: [Add Ons: Case, Add Ons: Acrylic] -> [["Add Ons", "Case, Acrylic"]]. Keeps the original order.
 * A repeated value (two Extra Leave add-ons) shows once with a count: "Extra Leave ×2". */
export function groupSpecs(specs: { name: string; value: string }[]): [string, string][] {
  const out: [string, { value: string; n: number }[]][] = [];
  for (const s of specs) {
    let same = out.find(([n]) => n === s.name);
    if (!same) { same = [s.name, []]; out.push(same); }
    const dup = same[1].find((x) => x.value === s.value);
    if (dup) dup.n++; else same[1].push({ value: s.value, n: 1 });
  }
  return out.map(([n, vs]) => [n, vs.map((x) => (x.n > 1 ? `${x.value} ×${x.n}` : x.value)).join(', ')]);
}

/** "Leaves: 15; Cover: 9; Add Ons: Case, Acrylic" */
export const specsText = (specs: { name: string; value: string }[]) => groupSpecs(specs).map(([n, v]) => `${n}: ${v}`).join('; ');

/** A customer's special discount on one product: centavos deducted from each item's normal price.
 * With optionValueId set it applies only when that option value (e.g. "Leaves: 15") is chosen on the line. */
export type SpecialPrice = { productId: number; amountOff: number; optionValueId?: number | null };

/** The special discount that applies to a line: one matching the chosen option values first, else the product-wide one. */
export function pickSpecialPrice(specials: SpecialPrice[] | null | undefined, productId: number, chosenValueIds: (number | null | undefined)[]): SpecialPrice | null {
  const mine = (specials ?? []).filter((sp) => sp.productId === productId);
  return mine.find((sp) => sp.optionValueId != null && chosenValueIds.includes(sp.optionValueId)) ?? mine.find((sp) => sp.optionValueId == null) ?? null;
}

/** The unit price this customer pays (normal minus their amount off, never below 0), or null when there is no special discount. */
export function applySpecialPrice(normal: number, sp: SpecialPrice | null | undefined): number | null {
  if (!sp || !(sp.amountOff > 0)) return null;
  return Math.max(0, normal - sp.amountOff);
}

/** "₱3.00 off each" */
export const specialPriceLabel = (sp: SpecialPrice, peso: (c: number) => string) => `${peso(sp.amountOff)} off each`;
