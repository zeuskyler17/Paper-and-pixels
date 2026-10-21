import Link from 'next/link';
import type { MaterialLevel } from '@prisma/client';
import { prisma } from '@/lib/db';
import { addDays, fmtDate, manilaRange, parseDateInput, todayManila } from '@/lib/dates';
import { fmtQty, peso } from '@/lib/money';
import { MATERIAL_LEVEL } from '@/lib/labels';
import { Card, Empty, FilterBar, Stat, TableWrap } from '@/components/ui';
import { MovementsTable, movementInclude } from './MovementsTable';

/** What counts as "consumed": stock released to workers / taken out, and materials auto-deducted by jobs
 *  (minus deductions returned to stock because the job / order was cancelled). */
const USED = ['STOCK_OUT', 'JOB_DEDUCT'] as const;

/** Daily consumption: every material used on one day — totals per material, then each movement. */
export async function DailyConsumption({ date, level }: { date?: string; level?: MaterialLevel }) {
  const day = parseDateInput(date) ? date! : todayManila();
  const isToday = day === todayManila();
  const { start, end } = manilaRange(day, day);
  const moves = await prisma.stockMovement.findMany({
    where: { type: { in: [...USED] }, returnedAt: null, createdAt: { gte: start, lt: end }, ...(level ? { material: { level } } : {}) },
    orderBy: { id: 'desc' },
    include: { ...movementInclude, material: { select: { id: true, name: true, unit: true, level: true } } },
  });

  type Sum = { id: number; name: string; unit: string; level: MaterialLevel; released: number; jobs: number; cost: number; to: Set<string> };
  const byMaterial = new Map<number, Sum>();
  for (const m of moves) {
    const s = byMaterial.get(m.materialId) ?? { id: m.material.id, name: m.material.name, unit: m.material.unit, level: m.material.level, released: 0, jobs: 0, cost: 0, to: new Set<string>() };
    const qty = -m.quantity; // movements are signed; usage is negative
    if (m.type === 'JOB_DEDUCT') s.jobs += qty; else s.released += qty;
    s.cost += Math.round(qty * m.unitCost);
    if (m.releasedTo) s.to.add(m.releasedTo.name);
    if (m.job) s.to.add(m.job.order.orderNo);
    byMaterial.set(m.materialId, s);
  }
  const rows = [...byMaterial.values()].sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
  const totalCost = rows.reduce((t, r) => t + r.cost, 0);
  const jobCost = moves.filter((m) => m.type === 'JOB_DEDUCT').reduce((t, m) => t + Math.round(-m.quantity * m.unitCost), 0);

  const href = (d: string) => `/inventory?view=daily&date=${d}${level ? `&level=${level}` : ''}`;
  const dayLabel = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(start);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href(addDays(day, -1))} className="btn-secondary btn-sm">← Previous day</Link>
        {!isToday && <Link href={href(todayManila())} className="btn-secondary btn-sm">Today</Link>}
        <Link href={href(addDays(day, 1))} className="btn-secondary btn-sm">Next day →</Link>
        <span className="ml-1 text-[14px] font-semibold">{dayLabel}</span>
        {isToday && <span className="text-[12px] font-semibold uppercase tracking-wide text-brand-700">Today</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Materials used" value={rows.length} />
        <Stat label="Cost of materials used" value={peso(totalCost)} hint="Quantity × unit cost at the time" />
        <Stat label="Released / stock out" value={peso(totalCost - jobCost)} hint={`${moves.filter((m) => m.type === 'STOCK_OUT').length} stock-out entries`} />
        <Stat label="Used by jobs (auto)" value={peso(jobCost)} hint="Bill-of-materials deductions" />
      </div>

      <FilterBar>
        <input type="hidden" name="view" value="daily" />
        <label><span className="label">Day</span><input type="date" name="date" defaultValue={day} className="input w-auto" /></label>
        <label>
          <span className="label">Level</span>
          <select name="level" defaultValue={level ?? ''} className="input w-auto">
            <option value="">All materials</option>
            {Object.entries(MATERIAL_LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </FilterBar>

      <Card title={`Consumed on ${fmtDate(start)}`}>
        {rows.length === 0 ? <Empty>No materials were used on this day.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Material</th><th>Level</th><th className="text-right">Released / out</th><th className="text-right">Used by jobs</th>
                  <th className="text-right">Total used</th><th className="text-right">Cost</th><th>Released to / jobs</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/inventory/${r.id}`} className="link">{r.name}</Link></td>
                    <td className="whitespace-nowrap">{MATERIAL_LEVEL[r.level]}</td>
                    <td className="text-right">{r.released ? `${fmtQty(r.released)} ${r.unit}` : '—'}</td>
                    <td className="text-right">{r.jobs ? `${fmtQty(r.jobs)} ${r.unit}` : '—'}</td>
                    <td className="text-right font-semibold">{fmtQty(r.released + r.jobs)} {r.unit}</td>
                    <td className="text-right">{peso(r.cost)}</td>
                    <td className="max-w-xs text-xs text-slate-600">{[...r.to].join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold"><td colSpan={5}>Total</td><td className="text-right">{peso(totalCost)}</td><td /></tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      {moves.length > 0 && (
        <Card title={`Every entry (${moves.length})`}>
          <MovementsTable rows={moves} showMaterial />
        </Card>
      )}
    </div>
  );
}
