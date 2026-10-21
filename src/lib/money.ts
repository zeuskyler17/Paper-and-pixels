// All money is integer centavos. These helpers are safe to use on server and client.

const fmt = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123450 -> "₱1,234.50" */
export function peso(centavos: number | null | undefined): string {
  return fmt.format((centavos ?? 0) / 100);
}

/** 123450 -> "1234.50" (for input default values / CSV) */
export function centavosToInput(centavos: number | null | undefined): string {
  return ((centavos ?? 0) / 100).toFixed(2);
}

/** Like toCentavos but keeps fractions of a centavo (to 4 decimals) — material costs per cm / ml. */
export function toCentavosPrecise(input: FormDataEntryValue | string | number | null | undefined): number {
  if (input === null || input === undefined) return NaN;
  const s = String(input).replace(/[₱,\s]/g, '');
  if (s === '' || !/^-?\d*(\.\d*)?$/.test(s)) return NaN;
  return Math.round(Number(s) * 1_000_000) / 10_000;
}

/** Cost per unit for input fields: 2 decimals, or up to 4 when the cost has fractions of a centavo. */
export function costToInput(centavos: number | null | undefined): string {
  const v = (centavos ?? 0) / 100;
  return Number.isInteger(centavos ?? 0) ? v.toFixed(2) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00');
}

/** "1,234.50" -> 123450. Returns NaN for invalid input. */
export function toCentavos(input: FormDataEntryValue | string | number | null | undefined): number {
  if (input === null || input === undefined) return NaN;
  const s = String(input).replace(/[₱,\s]/g, '');
  if (s === '') return NaN;
  if (!/^-?\d*(\.\d*)?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/** Like toCentavos but empty -> 0. */
export function toCentavosOrZero(input: FormDataEntryValue | string | number | null | undefined): number {
  const s = input === null || input === undefined ? '' : String(input).trim();
  return s === '' ? 0 : toCentavos(s);
}

/** Round material quantities to 3 decimals. */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function fmtQty(n: number): string {
  return round3(n).toLocaleString('en-PH', { maximumFractionDigits: 3 });
}
