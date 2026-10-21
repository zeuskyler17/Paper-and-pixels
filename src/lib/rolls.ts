// Roll paper helpers (client-safe). Roll materials keep their stock in a length unit (cm / m / in);
// these turn lengths into rolls for display and back for input.

type RollLike = { unit: string; rollLengthM: number | null };

/** Length of one roll in the material's own unit, or 0 when the material is not roll paper. */
export function rollLength(m: RollLike): number {
  if (!m.rollLengthM) return 0;
  return m.unit === 'cm' ? m.rollLengthM * 100 : m.unit === 'in' ? m.rollLengthM / 0.0254 : m.rollLengthM;
}

export function isRoll(m: RollLike): boolean {
  return rollLength(m) > 0;
}

const n = (v: number) => new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(Math.round(v));

/**
 * Stock as whole rolls plus the open roll: 48,313 cm with 8,600 cm rolls ->
 * { rolls: '5 rolls', open: '3,287 cm used · 5,313 cm left on the open roll', total: '48,313 cm' }.
 */
export function rollParts(qty: number, m: RollLike): { rolls: string; open: string | null; total: string } {
  const len = rollLength(m);
  const total = `${n(qty)} ${m.unit}`;
  if (!len) return { rolls: total, open: null, total };
  if (qty < 0) return { rolls: '0 rolls', open: `short by ${n(-qty)} ${m.unit}`, total };
  const full = Math.floor(qty / len + 1e-9);
  const left = qty - full * len;
  const open = left > 0.5 ? `${n(len - left)} ${m.unit} used · ${n(left)} ${m.unit} left on the open roll` : null;
  return { rolls: `${full} roll${full === 1 ? '' : 's'}`, open, total };
}

/** Whole rolls only (reorder levels, dashboard): "5 rolls". */
export function fmtRolls(qty: number, m: RollLike): string {
  return rollParts(qty, m).rolls;
}
