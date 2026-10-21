import { Field } from '@/components/ui';

type C = { name?: string; mobile?: string | null; facebook?: string | null; email?: string | null; address?: string | null; notes?: string | null; isInternal?: boolean };

export function CustomerFields({ c = {} }: { c?: C }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name *"><input name="name" defaultValue={c.name} className="input" required /></Field>
      <Field label="Mobile"><input name="mobile" defaultValue={c.mobile ?? ''} className="input" inputMode="tel" placeholder="09xx xxx xxxx" /></Field>
      <Field label="Facebook name / link"><input name="facebook" defaultValue={c.facebook ?? ''} className="input" /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={c.email ?? ''} className="input" /></Field>
      <Field label="Address" className="sm:col-span-2"><input name="address" defaultValue={c.address ?? ''} className="input" /></Field>
      <Field label="Notes" className="sm:col-span-2"><textarea name="notes" defaultValue={c.notes ?? ''} rows={2} className="input" /></Field>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="isInternal" defaultChecked={c.isInternal ?? false} className="mt-0.5" />
        <span><b>One of our branches</b> — orders for this customer are stock transfers: no prices, discounts or payments, and they are left out of sales figures.</span>
      </label>
    </div>
  );
}
