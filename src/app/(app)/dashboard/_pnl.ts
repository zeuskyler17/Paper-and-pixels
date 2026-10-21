import 'server-only';
import { prisma } from '@/lib/db';
import { TZ } from '@/lib/dates';

export type PnlMonth = {
  key: string;      // "2026-10"
  label: string;    // "Oct"
  year: number;
  sales: number;    // centavos: order totals after discounts (non-cancelled), by order date
  expenses: number; // centavos: non-voided expenses, by expense date
  materials: number;// centavos: materials used on jobs + manual stock out, at cost (returned deductions excluded)
  profit: number;   // sales − expenses − materials
};

type Row = { m: Date; v: number | bigint | null };
const n = (v: number | bigint | null) => Number(v ?? 0);

/** Monthly profit & loss for the last `months` calendar months (Manila), oldest first. Same formula as the Profit summary report. */
export async function monthlyPnl(months = 12): Promise<PnlMonth[]> {
  const count = Math.min(36, Math.max(3, months));
  const [sales, expenses, materials] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT date_trunc('month', o."createdAt" AT TIME ZONE ${TZ}) AS m, SUM(o.total) AS v
      FROM orders o JOIN customers c ON c.id = o."customerId" WHERE o.status <> 'CANCELLED' AND c."isInternal" = false
        AND o."createdAt" >= (date_trunc('month', now() AT TIME ZONE ${TZ}) - make_interval(months => ${count - 1}::int)) AT TIME ZONE ${TZ}
      GROUP BY 1`,
    prisma.$queryRaw<Row[]>`
      SELECT date_trunc('month', "date" AT TIME ZONE ${TZ}) AS m, SUM(amount) AS v
      FROM expenses WHERE voided = false
        AND "date" >= (date_trunc('month', now() AT TIME ZONE ${TZ}) - make_interval(months => ${count - 1}::int)) AT TIME ZONE ${TZ}
      GROUP BY 1`,
    prisma.$queryRaw<Row[]>`
      SELECT date_trunc('month', "createdAt" AT TIME ZONE ${TZ}) AS m, ROUND(SUM(-quantity * "unitCost")) AS v
      FROM stock_movements WHERE type IN ('JOB_DEDUCT', 'STOCK_OUT') AND "returnedAt" IS NULL
        AND "createdAt" >= (date_trunc('month', now() AT TIME ZONE ${TZ}) - make_interval(months => ${count - 1}::int)) AT TIME ZONE ${TZ}
      GROUP BY 1`,
  ]);
  // date_trunc on a timestamp-without-zone comes back as a Date at UTC midnight of that Manila month start.
  const keyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const map = (rows: Row[]) => new Map(rows.map((r) => [keyOf(new Date(r.m)), n(r.v)]));
  const s = map(sales), e = map(expenses), mt = map(materials);

  const nowManila = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const out: PnlMonth[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(nowManila.getFullYear(), nowManila.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const sl = s.get(key) ?? 0, ex = e.get(key) ?? 0, ma = mt.get(key) ?? 0;
    out.push({ key, label: d.toLocaleString('en-US', { month: 'short' }), year: d.getFullYear(), sales: sl, expenses: ex, materials: ma, profit: sl - ex - ma });
  }
  return out;
}
