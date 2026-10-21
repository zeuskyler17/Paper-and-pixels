import Link from 'next/link';
import type { MaterialLevel, MaterialUse, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser, getBranch } from '@/lib/auth';
import { fmtQty, peso } from '@/lib/money';
import { MATERIAL_LEVEL, MATERIAL_USE } from '@/lib/labels';
import { levelsFor } from '@/lib/branches';
import { fmtRolls, isRoll, rollParts } from '@/lib/rolls';
import { Badge, Card, Empty, FilterBar, PageHeader, Stat, TableWrap } from '@/components/ui';
import { DailyConsumption } from './_daily';

export const metadata = { title: 'Inventory' };

type SP = Promise<{ level?: string; use?: string; q?: string; low?: string; inactive?: string; view?: string; date?: string }>;

const USES: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  ...Object.entries(MATERIAL_USE).map(([value, label]) => ({ value, label })),
  { value: 'NONE', label: 'Not set' },
];

const FULL_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'RAW_RAW', label: 'Raw-raw (purchased)' },
  { value: 'RAW', label: 'Raw (cut/processed)' },
  { value: 'CONSUMABLE', label: 'Printing consumables' },
  { value: 'GENERAL', label: 'Daily consumption' },
];
const SIMPLE_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'FINISHED', label: 'Finished products (from P&P)' },
  { value: 'CONSUMABLE', label: 'Printing consumables' },
  { value: 'GENERAL', label: 'Daily consumption' },
];

export default async function InventoryPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser('inventory');
  const simple = !!getBranch()?.simpleInventory; // Keoni / KY: materials only, no levels or cutting
  const { level = '', use = '', q = '', low, inactive, view, date } = await searchParams;
  const validUse = (Object.keys(MATERIAL_USE).includes(use) ? (use as MaterialUse) : undefined);
  const noUse = use === 'NONE';
  const TABS = simple ? SIMPLE_TABS : FULL_TABS;
  const validLevel = levelsFor(simple).includes(level) ? (level as MaterialLevel) : undefined;
  const daily = view === 'daily';
  const tabHref = (lv: string, lowOnly = !!low, useKey = use) => {
    const p = new URLSearchParams();
    if (lv) p.set('level', lv);
    if (useKey) p.set('use', useKey);
    if (q) p.set('q', q);
    if (lowOnly) p.set('low', '1');
    if (inactive) p.set('inactive', '1');
    const s = p.toString();
    return s ? `/inventory?${s}` : '/inventory';
  };
  const header = (
    <PageHeader
      title="Inventory"
      subtitle={daily ? 'Usage by day — materials released and used by jobs on one day.' : simple ? 'Finished products received from Paper & Pixels, printer consumables and daily supplies. Stock changes only through stock in / out.' : 'Raw-raw → (cutting) → Raw → used by jobs. Stock changes only through movements.'}
      actions={<>
        <Link href="/inventory/out" className="btn-primary">Stock out</Link>
        {!simple && <Link href="/inventory/convert" className="btn-secondary">Cutting / conversion</Link>}
        <Link href="/inventory/movements" className="btn-secondary">All movements</Link>
        <Link href="/inventory/rolls" className="btn-secondary">Photo paper rolls</Link>
        <Link href="/inventory?view=daily" className={daily ? 'btn-primary' : 'btn-secondary'}>Usage by day</Link>
        <Link href={`/inventory/new${validLevel ? `?level=${validLevel}` : ''}`} className="btn-primary">+ New material</Link>
        {user.isAdmin && <Link href="/inventory/cleanup" className="btn-secondary" title="Delete or hide sample / unused materials">Clean up</Link>}
      </>}
    />
  );
  const tabBar = (
    <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-100 pb-3">
      {TABS.map((t) => (
        <Link key={t.value} href={tabHref(t.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${!daily && (level === t.value || (!validLevel && !t.value)) ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
  if (daily) {
    return (
      <div className="space-y-4">
        {header}
        <DailyConsumption date={date} level={validLevel} />
      </div>
    );
  }

  const where: Prisma.MaterialWhereInput = {
    ...(validLevel ? { level: validLevel } : {}),
    ...(validUse ? { usedFor: validUse } : noUse ? { usedFor: null } : {}),
    ...(inactive ? {} : { active: true }),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] } : {}),
  };
  const materials = await prisma.material.findMany({
    where, orderBy: [{ level: 'asc' }, { name: 'asc' }], include: { supplier: { select: { id: true, name: true } } },
  });

  const isLow = (m: { stock: number; reorderLevel: number }) => m.stock <= m.reorderLevel;
  const lowCount = materials.filter(isLow).length;
  const rows = low ? materials.filter(isLow) : materials;
  const totalValue = materials.reduce((s, m) => s + Math.round(Math.max(0, m.stock) * m.unitCost), 0);


  return (
    <div className="space-y-4">
      {header}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Materials" value={materials.length} />
        <Stat label="Low stock" value={lowCount} tone={lowCount > 0 ? 'red' : 'green'} href={tabHref(validLevel ?? '', true)} />
        <Stat label="Stock value" value={peso(totalValue)} hint="Stock × weighted average cost" />
      </div>
      <Card>
        {tabBar}
        {!simple && <div className="mb-3 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Used for</span>
          {USES.map((t) => (
            <Link key={t.value} href={tabHref(validLevel ?? '', !!low, t.value)}
              className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${use === t.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              {t.label}
            </Link>
          ))}
        </div>}
        <FilterBar>
          {validLevel && <input type="hidden" name="level" value={validLevel} />}
          {use && <input type="hidden" name="use" value={use} />}
          <input name="q" defaultValue={q} placeholder="Search name or SKU" className="input w-64" />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={!!low} /> Low stock only</label>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="inactive" value="1" defaultChecked={!!inactive} /> Include inactive</label>
        </FilterBar>
        {rows.length === 0 ? <Empty>No materials found.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>SKU</th>{!simple && <th>Used for</th>}<th>{simple ? 'Type' : 'Level'}</th><th>Unit</th><th className="text-right">Stock</th><th className="text-right">Reorder at</th>
                  <th className="text-right">Unit cost</th><th className="text-right">Stock value</th><th>Supplier</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const lowStock = isLow(m);
                  return (
                    <tr key={m.id} className={lowStock ? 'bg-red-50' : ''}>
                      <td>
                        <Link href={`/inventory/${m.id}`} className="link">{m.name}</Link>
                        {!m.active && <span className="ml-1"><Badge>Inactive</Badge></span>}
                        {lowStock && <span className="ml-1"><Badge tone="red">Low</Badge></span>}
                      </td>
                      <td>{m.sku ?? '—'}</td>
                      {!simple && <td className="whitespace-nowrap">{m.usedFor ? <Badge tone={m.usedFor === 'ALBUM' ? 'purple' : m.usedFor === 'FRAME' ? 'amber' : m.usedFor === 'PRINTING' ? 'blue' : m.usedFor === 'GENERAL' ? 'green' : 'gray'}>{MATERIAL_USE[m.usedFor]}</Badge> : <span className="text-xs text-slate-400">Not set</span>}</td>}
                      <td className="whitespace-nowrap">{MATERIAL_LEVEL[m.level]}</td>
                      <td>{m.unit}</td>
                      <td className={`text-right font-semibold ${lowStock ? 'text-red-600' : ''}`}>{isRoll(m) ? (() => { const r = rollParts(m.stock, m); return <>{r.rolls}<div className="text-[11px] font-normal text-slate-500">{r.open ?? 'no open roll'}</div><div className="text-[11px] font-normal text-slate-400">{r.total}</div></>; })() : fmtQty(m.stock)}</td>
                      <td className="text-right text-slate-500">{isRoll(m) ? fmtRolls(m.reorderLevel, m) : fmtQty(m.reorderLevel)}</td>
                      <td className="text-right">{peso(m.unitCost)}</td>
                      <td className="text-right">{peso(Math.round(Math.max(0, m.stock) * m.unitCost))}</td>
                      <td>{m.supplier ? <Link href={`/suppliers/${m.supplier.id}`} className="link">{m.supplier.name}</Link> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
