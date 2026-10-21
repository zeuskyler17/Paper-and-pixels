import { Field, Select } from '@/components/ui';
import { MATERIAL_LEVEL, MATERIAL_USE, options } from '@/lib/labels';
import { FULL_LEVELS, SIMPLE_LEVELS } from '@/lib/branches';
import { costToInput } from '@/lib/money';

type M = {
  name?: string; sku?: string | null; level?: string; usedFor?: string | null; unit?: string; reorderLevel?: number; unitCost?: number;
  supplierId?: number | null; notes?: string | null; active?: boolean; rollWidthCm?: number | null; rollLengthM?: number | null;
};

export function MaterialFields({ m = {}, suppliers, isNew = false, simple = false }: { m?: M; suppliers: { id: number; name: string }[]; isNew?: boolean; simple?: boolean }) {
  const rollLen = m.rollLengthM ? (m.unit === 'cm' ? m.rollLengthM * 100 : m.unit === 'in' ? m.rollLengthM / 0.0254 : m.rollLengthM) : 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name *"><input name="name" defaultValue={m.name} className="input" required placeholder="e.g. PVC sheet 4x8 ft (3mm)" /></Field>
      <Field label="SKU / code"><input name="sku" defaultValue={m.sku ?? ''} className="input" /></Field>
      {simple ? (
        <>
          <Field label="Type *" hint="Finished products come from Paper & Pixels (albums, frames) and are received with Stock in. Printing consumables are for the branch's own printer (ink, paper). Daily consumption = tape, gloves, cleaning.">
            <Select name="level" options={SIMPLE_LEVELS.map((k) => ({ value: k, label: MATERIAL_LEVEL[k] }))} defaultValue={m.level && (SIMPLE_LEVELS as readonly string[]).includes(m.level) ? m.level : 'FINISHED'} required />
          </Field>
          <input type="hidden" name="usedFor" value={m.usedFor ?? 'GENERAL'} />
        </>
      ) : (<>
      <Field label="Level *" hint="Raw-raw = as purchased (full sheet, roll, ream). Raw = cut/processed. Printing consumable = ink, paper, film. Daily consumption = supplies used up day to day (tape, gloves, alcohol, cleaning).">
        <Select name="level" options={FULL_LEVELS.map((k) => ({ value: k, label: MATERIAL_LEVEL[k] }))} defaultValue={m.level ?? 'RAW_RAW'} required />
      </Field>
      <Field label="Used for *" hint="Which product line this stock is for. Pick Shared when several lines use it (e.g. double-sided tape).">
        <Select name="usedFor" options={options(MATERIAL_USE)} defaultValue={m.usedFor ?? ''} placeholder="— choose —" required />
      </Field>
      </>)}
      <Field label="Unit *" hint="sheet, pc, roll, ream, ml, bottle, ft… Photo paper rolls: use m (metres) and fill in the roll size below."><input name="unit" defaultValue={m.unit ?? ''} className="input" required /></Field>
      <Field label="Roll width (cm)" hint="Photo paper rolls only."><input name="rollWidthCm" type="number" step="0.1" min="0" defaultValue={m.rollWidthCm ?? ''} className="input" /></Field>
      <Field label="Length of one roll (m)" hint="e.g. 86 for 8,600 cm. Lets Inventory show metres as rolls."><input name="rollLengthM" type="number" step="0.1" min="0" defaultValue={m.rollLengthM ?? ''} className="input" /></Field>
      <Field label={rollLen ? 'Reorder level (rolls)' : 'Reorder level'} hint={rollLen ? `Flagged as low when fewer rolls than this are left (1 roll = ${rollLen} ${m.unit}).` : 'Flagged as low stock when stock is at or below this. Roll paper: enter rolls.'}>
        <input name="reorderLevel" type="number" step={rollLen ? 0.5 : 0.001} min="0" defaultValue={rollLen ? Math.round(((m.reorderLevel ?? 0) / rollLen) * 100) / 100 : (m.reorderLevel ?? 0)} className="input" />
      </Field>
      <Field label={isNew ? 'Unit cost (₱)' : 'Unit cost (₱, weighted average)'} hint={isNew ? 'Initial cost per unit. For roll paper (roll length filled in below): the cost of ONE ROLL — it is converted to cost per cm.' : 'Updated automatically by stock-ins; edit only to correct it. Roll paper: per cm.'}>
        <input name="unitCost" inputMode="decimal" defaultValue={costToInput(m.unitCost ?? 0)} className="input" />
      </Field>
      {isNew && (
        <Field label="Opening stock" hint="Current quantity on hand (recorded as an adjustment). Roll paper: number of ROLLS on hand.">
          <input name="openingStock" type="number" step="0.001" min="0" defaultValue="0" className="input" />
        </Field>
      )}
      <Field label="Supplier">
        <Select name="supplierId" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} defaultValue={m.supplierId ?? ''} placeholder="— none —" />
      </Field>
      <Field label="Notes" className="sm:col-span-2"><textarea name="notes" defaultValue={m.notes ?? ''} rows={2} className="input" /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={m.active ?? true} /> Active (uncheck to hide from lists and pickers)
      </label>
    </div>
  );
}
