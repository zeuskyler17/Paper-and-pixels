import { centavosToInput } from '@/lib/money';
import { toDateInput } from '@/lib/dates';
import { DELIVERY_METHOD, options } from '@/lib/labels';
import { Field, Select } from '@/components/ui';

export type DeliveryDefaults = {
  method?: string | null;
  recipient?: string | null;
  contactNo?: string | null;
  address?: string | null;
  rider?: string | null;
  trackingNo?: string | null;
  fee?: number | null;
  scheduledDate?: Date | null;
  notes?: string | null;
};

export function DeliveryFields({ d = {} }: { d?: DeliveryDefaults }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Method">
        <Select name="method" options={options(DELIVERY_METHOD)} defaultValue={d.method ?? 'PICKUP'} required />
      </Field>
      <Field label="Scheduled date">
        <input type="date" name="scheduledDate" defaultValue={toDateInput(d.scheduledDate)} className="input" />
      </Field>
      <Field label="Recipient">
        <input name="recipient" defaultValue={d.recipient ?? ''} className="input" />
      </Field>
      <Field label="Contact no.">
        <input name="contactNo" defaultValue={d.contactNo ?? ''} className="input" inputMode="tel" />
      </Field>
      <Field label="Address" className="sm:col-span-2" hint="Required for deliveries; optional for pickup.">
        <textarea name="address" rows={2} defaultValue={d.address ?? ''} className="input" />
      </Field>
      <Field label="Rider / courier">
        <input name="rider" defaultValue={d.rider ?? ''} className="input" placeholder="e.g. Lalamove driver name, plate no." />
      </Field>
      <Field label="Tracking no.">
        <input name="trackingNo" defaultValue={d.trackingNo ?? ''} className="input" />
      </Field>
      <Field label="Delivery fee (₱)" hint="For reference only — not added to the order total.">
        <input name="fee" inputMode="decimal" defaultValue={d.fee ? centavosToInput(d.fee) : ''} className="input" placeholder="0.00" />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <textarea name="notes" rows={2} defaultValue={d.notes ?? ''} className="input" />
      </Field>
    </div>
  );
}
