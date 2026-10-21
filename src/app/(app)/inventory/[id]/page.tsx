import { ASSIGNABLE_WORKER } from '@/lib/permissions';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser, getBranch } from '@/lib/auth';
import { fmtRolls, rollParts } from '@/lib/rolls';
import { centavosToInput, fmtQty, peso, costToInput } from '@/lib/money';
import { MATERIAL_LEVEL, MATERIAL_USE } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Card, Field, PageHeader, Stat } from '@/components/ui';
import { adjustStock, stockIn, stockOut, updateMaterial } from '../actions';
import { MaterialFields } from '../MaterialFields';
import { MovementsTable, movementInclude } from '../MovementsTable';

export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('inventory');
  const simple = !!getBranch()?.simpleInventory;
  const { id } = await params;
  const material = await prisma.material.findUnique({
    where: { id: Number(id) || 0 },
    include: { supplier: { select: { id: true, name: true } } },
  });
  if (!material) notFound();
  const [movements, movementCount, suppliers, workers] = await Promise.all([
    prisma.stockMovement.findMany({ where: { materialId: material.id }, orderBy: { id: 'desc' }, take: 200, include: movementInclude }),
    prisma.stockMovement.count({ where: { materialId: material.id } }),
    prisma.supplier.findMany({
      where: { OR: [{ active: true }, { id: material.supplierId ?? -1 }] }, orderBy: { name: 'asc' }, select: { id: true, name: true },
    }),
    prisma.user.findMany({ where: ASSIGNABLE_WORKER, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  const low = material.stock <= material.reorderLevel;
  const u = material.unit;
  // Roll paper: stock in is entered by the roll and converted to the material's length unit.
  const rollLen = material.rollLengthM ? (u === 'cm' ? material.rollLengthM * 100 : u === 'in' ? material.rollLengthM / 0.0254 : material.rollLengthM) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={material.name}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          {simple ? MATERIAL_LEVEL[material.level] : <>{MATERIAL_LEVEL[material.level]}{material.usedFor && <> · for {MATERIAL_USE[material.usedFor]}</>}</>}{material.sku && <> · SKU {material.sku}</>}
          {material.supplier && <> · <Link href={`/suppliers/${material.supplier.id}`} className="link">{material.supplier.name}</Link></>}
          {!material.active && <Badge>Inactive</Badge>}
        </span>}
        actions={<>
          {!simple && material.level === 'RAW_RAW' && <Link href={`/inventory/convert?input=${material.id}`} className="btn-secondary">Cut / convert</Link>}
          {material.supplierId && <Link href={`/purchase-orders/new?supplierId=${material.supplierId}`} className="btn-secondary">New PO</Link>}
          <Link href="/inventory" className="btn-secondary">Back to inventory</Link>
        </>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Current stock" value={rollLen ? rollParts(material.stock, material).rolls : <>{fmtQty(material.stock)} <span className="text-base font-medium text-slate-500">{u}</span></>} tone={low ? 'red' : 'green'} hint={rollLen ? `${rollParts(material.stock, material).open ?? 'no open roll'} · ${rollParts(material.stock, material).total} in all${low ? ' · at or below reorder level' : ''}` : low ? 'At or below reorder level' : undefined} />
        <Stat label="Reorder level" value={rollLen ? fmtRolls(material.reorderLevel, material) : <>{fmtQty(material.reorderLevel)} <span className="text-base font-medium text-slate-500">{u}</span></>} />
        <Stat label="Unit cost (avg)" value={peso(material.unitCost)} hint={`per ${u}`} />
        <Stat label="Stock value" value={peso(Math.round(Math.max(0, material.stock) * material.unitCost))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Stock in (purchase without PO)">
          <ActionForm action={stockIn.bind(null, material.id)} className="space-y-3" resetOnSuccess>
            {rollLen ? (
              <div className="grid grid-cols-2 gap-3">
                <input type="hidden" name="byRoll" value="1" />
                <Field label="Rolls *" hint={`1 roll = ${fmtQty(rollLen)} ${u}`}><input name="qty" type="number" step="0.5" min="0.5" defaultValue={1} required className="input" /></Field>
                <Field label="Cost per roll (₱) *" hint={`≈ ₱${(material.unitCost / 100).toFixed(4)} per ${u} now`}><input name="unitCost" inputMode="decimal" defaultValue={((material.unitCost * rollLen) / 100).toFixed(2)} required className="input" /></Field>
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Qty (${u}) *`}><input name="qty" type="number" step="0.001" min="0.001" required className="input" /></Field>
              <Field label="Unit cost (₱) *"><input name="unitCost" inputMode="decimal" defaultValue={costToInput(material.unitCost)} required className="input" /></Field>
            </div>
            )}
            <Field label="Notes"><input name="notes" className="input" placeholder="e.g. bought at hardware store, OR #123" /></Field>
            <SubmitButton>Add stock</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Stock out">
          <ActionForm action={stockOut.bind(null, material.id)} className="space-y-3" resetOnSuccess>
            <Field label={`Qty (${u}) *`} hint={`On hand: ${fmtQty(material.stock)} ${u}`}><input name="qty" type="number" step="0.001" min="0.001" required className="input" /></Field>
            <Field label="Released to (worker)">
              <select name="releasedToId" className="input" defaultValue="">
                <option value="">— not released to a worker —</option>
                {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="Notes / purpose" hint="Required when not released to a worker."><input name="notes" className="input" placeholder="e.g. damaged, sample, walk-in job" /></Field>
            <SubmitButton className="btn-secondary">Remove stock</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Adjustment (physical count)">
          <ActionForm action={adjustStock.bind(null, material.id)} className="space-y-3" resetOnSuccess>
            <Field label={`Counted qty (${u}) *`} hint={`System stock: ${fmtQty(material.stock)} ${u}. The difference is recorded.`}>
              <input name="counted" type="number" step="0.001" min="0" required className="input" />
            </Field>
            <Field label="Reason *"><input name="reason" required className="input" placeholder="e.g. monthly inventory count" /></Field>
            <SubmitButton className="btn-secondary">Save count</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card title={`Stock movements${movementCount > movements.length ? ` (latest ${movements.length} of ${movementCount})` : ''}`}
        actions={<Link href={`/inventory/movements?materialId=${material.id}`} className="link text-sm">Filter / full history</Link>}>
        <MovementsTable rows={movements} />
      </Card>

      <Card title="Material details">
        <ActionForm action={updateMaterial.bind(null, material.id)} className="space-y-4">
          <MaterialFields m={material} suppliers={suppliers} simple={simple} />
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
