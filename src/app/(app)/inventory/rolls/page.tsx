import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fmtQty, peso } from '@/lib/money';
import { manilaDayRange, startOfMonthManila } from '@/lib/dates';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Card, Empty, Field, PageHeader, Stat, TableWrap } from '@/components/ui';
import { loadRolls, recordPrintedLength } from './actions';

export const metadata = { title: 'Photo paper rolls' };

/**
 * Photo printing paper by the roll. Stock is kept in metres; this page shows it as
 * rolls + metres left on the open roll, what was printed this month, and lets staff load a new
 * roll or record a printed length that did not go through an order.
 */
export default async function RollsPage() {
  await requireUser('inventory');
  const monthStart = manilaDayRange(startOfMonthManila()).start;
  const rolls = await prisma.material.findMany({
    where: { rollLengthM: { not: null }, active: true },
    orderBy: [{ rollWidthCm: 'desc' }, { name: 'asc' }],
    include: { movements: { where: { createdAt: { gte: monthStart }, type: { in: ['JOB_DEDUCT', 'STOCK_OUT'] }, returnedAt: null }, select: { quantity: true } } },
  });
  const rows = rolls.map((m) => {
    const len = m.unit === 'cm' ? m.rollLengthM! * 100 : m.rollLengthM!; // one roll, in the material's unit
    const full = Math.floor(m.stock / len + 1e-9);
    const open = Math.max(0, m.stock - full * len);
    const usedM = m.movements.reduce((t, x) => t + Math.max(0, -x.quantity), 0);
    return { ...m, len, full, open, usedM, prints: m.movements.length, low: m.stock <= m.reorderLevel, value: Math.round(Math.max(0, m.stock) * m.unitCost) };
  });
  const totalValue = rows.reduce((t, r) => t + r.value, 0);
  const usedValue = rows.reduce((t, r) => t + Math.round(r.usedM * r.unitCost), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Photo paper rolls"
        subtitle="Roll stock by length (cm): length left = roll length − lengths printed. One roll is counted for every full roll length. Orders deduct their print lengths automatically; use the forms for a new roll or a print outside an order."
        actions={<><Link href="/inventory/new" className="btn-secondary">+ New roll type</Link><Link href="/inventory" className="btn-secondary">Back to inventory</Link></>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Roll types" value={rows.length} />
        <Stat label="Low on paper" value={rows.filter((r) => r.low).length} tone={rows.some((r) => r.low) ? 'red' : 'green'} />
        <Stat label="Paper on hand (value)" value={peso(totalValue)} hint="length on hand × cost per unit" />
        <Stat label="Printed this month" value={peso(usedValue)} hint={`${rows.map((r) => fmtQty(r.usedM) + ' ' + r.unit).filter((s) => !s.startsWith('0 ')).slice(0, 3).join(', ') || '0'} across ${rows.reduce((t, r) => t + r.prints, 0)} deductions`} />
      </div>

      <Card>
        {rows.length === 0 ? <Empty>No roll materials yet. Add a material with unit <b>m</b> and fill in its roll width and length.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Paper</th><th>Roll size</th><th className="text-right">On hand</th><th className="text-right">Metres left</th>
                  <th className="text-right">Printed this month</th><th className="text-right">Cost / unit</th><th className="text-right">Value</th><th>Reorder at</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.low ? 'bg-red-50' : ''}>
                    <td><Link href={`/inventory/${r.id}`} className="link font-semibold">{r.name}</Link>{r.low && <span className="ml-1"><Badge tone="red">Low</Badge></span>}<div className="text-[11px] text-slate-500">{r.sku ?? ''}</div></td>
                    <td className="whitespace-nowrap text-[12.5px]">{r.rollWidthCm ? `${fmtQty(r.rollWidthCm)} cm wide` : '—'} · {fmtQty(r.len)} {r.unit} long</td>
                    <td className="text-right whitespace-nowrap"><span className="font-semibold">{r.full} roll{r.full === 1 ? '' : 's'}</span>{r.open > 0.0005 && <div className="text-[11.5px] text-slate-500">+ open roll {fmtQty(r.open)} {r.unit} ({Math.round((r.open / r.len) * 100)}%)</div>}</td>
                    <td className="text-right font-semibold">{fmtQty(r.stock)} {r.unit}</td>
                    <td className="text-right">{fmtQty(r.usedM)} {r.unit}<div className="text-[11px] text-slate-500">{r.prints} deduction{r.prints === 1 ? '' : 's'}</div></td>
                    <td className="text-right">₱{(r.unitCost / 100).toFixed(4)} / {r.unit}</td>
                    <td className="text-right">{peso(r.value)}</td>
                    <td className="text-[12px] text-slate-600">{fmtQty(r.reorderLevel)} {r.unit} ≈ {fmtQty(r.reorderLevel / r.len)} rolls</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {rows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id} title={r.name} actions={<span className="text-xs text-slate-500">{fmtQty(r.stock)} {r.unit} on hand</span>}>
              <div className="grid gap-4 sm:grid-cols-2">
                <ActionForm action={loadRolls.bind(null, r.id)} resetOnSuccess className="space-y-2">
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">Load new roll(s)</div>
                  <Field label="Rolls *" hint={`Each adds ${fmtQty(r.len)} ${r.unit} at ₱${(r.unitCost / 100).toFixed(4)}/${r.unit}`}><input name="rolls" type="number" min={1} max={50} step={1} defaultValue={1} className="input" required /></Field>
                  <input name="notes" className="input" placeholder="Delivery / receipt no. (optional)" />
                  <SubmitButton className="btn-primary btn-sm">Load</SubmitButton>
                </ActionForm>
                <ActionForm action={recordPrintedLength.bind(null, r.id)} resetOnSuccess className="space-y-2">
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">Record a print outside an order</div>
                  <div className="grid grid-cols-[1fr_6rem] gap-2">
                    <Field label="Length printed *"><input name="length" type="number" min={0.1} step={0.1} className="input" required placeholder="e.g. 14" /></Field>
                    <Field label="Unit"><select name="unit" defaultValue="in" className="input"><option value="in">inches</option><option value="cm">cm</option><option value="m">m</option></select></Field>
                  </div>
                  <input name="notes" className="input" placeholder="What was printed * (reprint, test print, PP-2026-…)" required />
                  <SubmitButton className="btn-secondary btn-sm">Deduct</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="text-[12px] text-slate-500">Example: a 10R roll is 25.4 cm × 8,600 cm. Printing a 10x14 uses 14 in = 35.56 cm; after 100 such prints 3,556 cm are gone and the page shows "0 rolls + open roll 5,044 cm (59%)". Every deduction is in the material's stock card.</p>
    </div>
  );
}
