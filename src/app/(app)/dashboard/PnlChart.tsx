import Link from 'next/link';
import { peso } from '@/lib/money';
import { Card } from '@/components/ui';
import type { PnlMonth } from './_pnl';

const INCOME = '#15803d';   // emerald-700
const SPEND = '#b91c1c';    // red-700
const PROFIT = '#1452d9';   // brand-600
const LOSS = '#f59e0b';     // amber-500

/** Short peso for axis ticks: ₱12.5k, ₱1.2M. */
function short(c: number): string {
  const v = Math.abs(c) / 100, sign = c < 0 ? '−' : '';
  if (v >= 1_000_000) return `${sign}₱${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${sign}₱${(v / 1_000).toFixed(v >= 100_000 ? 0 : 1)}k`;
  return `${sign}₱${Math.round(v)}`;
}

/** "Nice" axis step so ticks land on round numbers. */
function niceStep(max: number, ticks = 4): number {
  const raw = max / ticks, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const r = raw / mag;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
}

/**
 * Monthly profit & loss: income (net sales) and spending (expenses + materials used) as bars,
 * profit as a line. Plain inline SVG — no chart library, prints fine.
 */
export function PnlChart({ months, span }: { months: PnlMonth[]; span: number }) {
  const spending = (m: PnlMonth) => m.expenses + m.materials;
  const totals = months.reduce((t, m) => ({ sales: t.sales + m.sales, spend: t.spend + spending(m), profit: t.profit + m.profit }), { sales: 0, spend: 0, profit: 0 });
  const best = months.reduce<PnlMonth | null>((b, m) => (m.sales > 0 && (!b || m.profit > b.profit) ? m : b), null);
  const hasData = months.some((m) => m.sales || m.expenses || m.materials);

  // Layout (viewBox units; the SVG scales to the card width).
  const W = 960, H = 300, padL = 64, padR = 16, padT = 16, padB = 36;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxBar = Math.max(1, ...months.map((m) => Math.max(m.sales, spending(m), m.profit)));
  const minVal = Math.min(0, ...months.map((m) => m.profit));
  const step = niceStep(maxBar);
  const top = Math.ceil(maxBar / step) * step;
  const bottom = minVal < 0 ? -Math.ceil(-minVal / step) * step : 0;
  const y = (v: number) => padT + ((top - v) / (top - bottom)) * plotH;
  const slot = plotW / months.length, barW = Math.min(26, slot * 0.28), gap = 3;
  const x0 = (i: number) => padL + slot * i + slot / 2;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + 1e-6; v += step) ticks.push(v);
  const line = months.map((m, i) => `${x0(i).toFixed(1)},${y(m.profit).toFixed(1)}`).join(' ');

  return (
    <Card
      title="Profit & loss"
      actions={
        <span className="flex items-center gap-1 text-xs">
          {[6, 12, 24].map((n) => (
            <Link key={n} href={`/dashboard?pnl=${n}`} className={`rounded px-2 py-0.5 font-semibold ${span === n ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{n} mo</Link>
          ))}
          <Link href="/reports/profit" className="link ml-2">Full report</Link>
        </span>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        <div><div className="label mb-0.5">Income · {span} mo</div><div className="font-mono text-[17px] font-semibold text-emerald-700">{peso(totals.sales)}</div></div>
        <div><div className="label mb-0.5">Spending · {span} mo</div><div className="font-mono text-[17px] font-semibold text-red-700">{peso(totals.spend)}</div></div>
        <div><div className="label mb-0.5">Profit · {span} mo</div><div className={`font-mono text-[17px] font-semibold ${totals.profit >= 0 ? 'text-brand-700' : 'text-amber-600'}`}>{peso(totals.profit)}</div></div>
        <div><div className="label mb-0.5">Best month</div><div className="font-mono text-[17px] font-semibold text-slate-800">{best ? `${best.label} ${best.year} · ${peso(best.profit)}` : '—'}</div></div>
      </div>

      {!hasData ? <p className="py-10 text-center text-sm text-slate-500">No sales or expenses recorded yet in this period.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly income, spending and profit" className="h-auto w-full font-mono">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#94a3b8' : '#e2e8f0'} strokeWidth={v === 0 ? 1.2 : 1} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#64748b">{short(v)}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = x0(i), sp = spending(m);
            const bar = (v: number, dx: number, color: string, title: string) => v > 0 && (
              <rect x={cx + dx} y={y(v)} width={barW} height={Math.max(1.5, y(0) - y(v))} rx={2} fill={color}><title>{title}</title></rect>
            );
            return (
              <g key={m.key}>
                {bar(m.sales, -barW - gap / 2, INCOME, `${m.label} ${m.year} — Income ${peso(m.sales)}`)}
                {bar(sp, gap / 2, SPEND, `${m.label} ${m.year} — Spending ${peso(sp)} (expenses ${peso(m.expenses)} + materials ${peso(m.materials)})`)}
                <text x={cx} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#475569">{m.label}</text>
                {(i === 0 || m.label === 'Jan') && <text x={cx} y={H - padB + 29} textAnchor="middle" fontSize="10" fill="#94a3b8">{m.year}</text>}
              </g>
            );
          })}
          <polyline points={line} fill="none" stroke={PROFIT} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {months.map((m, i) => (
            <circle key={m.key} cx={x0(i)} cy={y(m.profit)} r={4.5} fill={m.profit >= 0 ? PROFIT : LOSS} stroke="#fff" strokeWidth={1.5}>
              <title>{`${m.label} ${m.year} — Profit ${peso(m.profit)}`}</title>
            </circle>
          ))}
        </svg>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-slate-600">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: INCOME }} />Income — order totals after discounts</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SPEND }} />Spending — expenses + materials used at cost</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PROFIT }} />Profit — income − spending <span className="text-slate-400">(amber dot = loss)</span></span>
      </div>
    </Card>
  );
}
