import { Field } from '@/components/ui';

type S = {
  name?: string; contactPerson?: string | null; mobile?: string | null; email?: string | null; address?: string | null;
  paymentTerms?: string | null; notes?: string | null; active?: boolean;
};

export function SupplierFields({ s = {} }: { s?: S }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name *"><input name="name" defaultValue={s.name} className="input" required /></Field>
      <Field label="Contact person"><input name="contactPerson" defaultValue={s.contactPerson ?? ''} className="input" /></Field>
      <Field label="Mobile"><input name="mobile" defaultValue={s.mobile ?? ''} className="input" inputMode="tel" placeholder="09xx xxx xxxx" /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={s.email ?? ''} className="input" /></Field>
      <Field label="Address" className="sm:col-span-2"><input name="address" defaultValue={s.address ?? ''} className="input" /></Field>
      <Field label="Payment terms" hint='e.g. "COD", "15 days", "30 days PDC"'><input name="paymentTerms" defaultValue={s.paymentTerms ?? ''} className="input" /></Field>
      <div className="hidden sm:block" />
      <Field label="Notes" className="sm:col-span-2"><textarea name="notes" defaultValue={s.notes ?? ''} rows={2} className="input" /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={s.active ?? true} /> Active
      </label>
    </div>
  );
}
