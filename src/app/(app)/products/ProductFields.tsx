import { Field, Select } from '@/components/ui';
import { options, PRICING_MODE } from '@/lib/labels';
import { centavosToInput } from '@/lib/money';

type P = {
  categoryId?: number;
  name?: string;
  description?: string | null;
  pricingMode?: string;
  basePrice?: number;
  unit?: string;
  active?: boolean;
};

export function ProductFields({ p = {}, categories }: { p?: P; categories: { id: number; name: string }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Category *">
        <Select name="categoryId" required defaultValue={p.categoryId} placeholder="— choose —" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Field label="Name *"><input name="name" defaultValue={p.name} className="input" required /></Field>
      <Field label="Pricing mode *" hint="Per square foot: base price × width × height (tarpaulin, sintra board, etc.)">
        <Select name="pricingMode" required defaultValue={p.pricingMode ?? 'FIXED'} options={options(PRICING_MODE)} />
      </Field>
      <Field label="Base price (₱) *" hint="Per piece, or per sq ft for per-square-foot products.">
        <input name="basePrice" defaultValue={p.basePrice != null ? centavosToInput(p.basePrice) : ''} className="input" inputMode="decimal" required />
      </Field>
      <Field label="Unit" hint="e.g. pc, album, set, sq ft"><input name="unit" defaultValue={p.unit ?? 'pc'} className="input" /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={p.active ?? true} /> Active (available in the POS)
      </label>
      <Field label="Description" className="sm:col-span-2"><textarea name="description" defaultValue={p.description ?? ''} rows={2} className="input" /></Field>
    </div>
  );
}
