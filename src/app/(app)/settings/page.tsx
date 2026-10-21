import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Field, PageHeader, Select } from '@/components/ui';
import { saveSettings } from './actions';
import { PaymentAccounts } from './PaymentAccounts';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireUser('settings');
  const s = await getSettings();

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Settings" subtitle="Shop details printed on order slips and receipts, and inventory behaviour." />

      <Card title="Shop details & receipts">
        <ActionForm action={saveSettings} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Shop name *"><input name="shop_name" defaultValue={s.shop_name} className="input" required /></Field>
            <Field label="Contact number"><input name="shop_contact" defaultValue={s.shop_contact} className="input" inputMode="tel" placeholder="09xx xxx xxxx" /></Field>
            <Field label="Address" className="sm:col-span-2"><input name="shop_address" defaultValue={s.shop_address} className="input" /></Field>
            <Field label="Facebook page"><input name="shop_facebook" defaultValue={s.shop_facebook} className="input" placeholder="facebook.com/yourpage" /></Field>
            <Field label="Email"><input name="shop_email" type="email" defaultValue={s.shop_email} className="input" /></Field>
            <Field label="Receipt / order slip footer" className="sm:col-span-2" hint="Printed at the bottom of every order slip and receipt.">
              <textarea name="receipt_footer" defaultValue={s.receipt_footer} rows={3} className="input" />
            </Field>
            <Field label="Deduct materials (BOM) from stock" className="sm:col-span-2" hint="Materials in a product's bill of materials are deducted once per job, automatically.">
              <Select
                name="bom_deduct_on"
                defaultValue={s.bom_deduct_on}
                required
                options={[
                  { value: 'IN_PROCESS', label: 'When job is marked In Process' },
                  { value: 'COMPLETED', label: 'When job is marked Completed' },
                ]}
              />
            </Field>
            <Field label="Late grace period (minutes)" hint="Time-ins up to this many minutes after the shift start count as on time. 0 = no grace period.">
              <input name="late_grace_minutes" type="number" min={0} max={60} step={1} defaultValue={s.late_grace_minutes} className="input" required />
            </Field>
            <Field label="Time clock selfie" hint="Takes a photo with the device camera at every time in / out. Only admins can view the photos.">
              <Select
                name="clock_require_photo"
                defaultValue={s.clock_require_photo}
                required
                options={[
                  { value: 'true', label: 'Required — no photo, no punch' },
                  { value: 'false', label: 'Optional — take a photo if a camera is available' },
                ]}
              />
            </Field>
            <Field label="Time clock location (GPS)" hint="Records where the device was at every time in / out. The browser asks for location permission once per device. Only admins can see locations.">
              <Select
                name="clock_require_location"
                defaultValue={s.clock_require_location}
                required
                options={[
                  { value: 'true', label: 'Required — no location, no punch' },
                  { value: 'false', label: 'Optional — record it when available' },
                ]}
              />
            </Field>
            <Field label="Shop location (lat, lng)" hint="Optional. Paste from Google Maps (right-click the shop → copy the numbers), e.g. 15.9285, 120.3487. Timekeeping then shows how far from the shop each punch was.">
              <input name="shop_location" defaultValue={s.shop_location} className="input" placeholder="15.9285, 120.3487" />
            </Field>
          </div>
          <SubmitButton>Save settings</SubmitButton>
        </ActionForm>
      </Card>

      <PaymentAccounts />

      <Card title="Expense categories">
        <p className="text-sm text-slate-600">
          Add, rename or hide the categories used when recording expenses (Materials, Utilities, Salaries…).
        </p>
        <Link href="/expenses/categories" className="btn-secondary mt-3">Manage expense categories</Link>
      </Card>

      <Card title="Backups">
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            Everything — orders, payments, inventory, job photos and expense receipts — lives in the PostgreSQL database,
            so <strong>one database backup covers the whole system</strong>.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              On a server, <code className="rounded bg-slate-100 px-1">scripts/backup.sh</code> runs every night at 11:30 PM (cron) and keeps the last 30 daily copies in the
              <code className="rounded bg-slate-100 px-1">backups/</code> folder.
            </li>
            <li>Copy the backups off the server too (e.g. to Google Drive with rclone) so a dead server never means lost data.</li>
            <li>Managed databases (Neon, Railway, Supabase) also keep their own automatic backups / point-in-time restore.</li>
            <li>To restore, use <code className="rounded bg-slate-100 px-1">scripts/restore.sh backups/&lt;file&gt;.dump</code>. Test a restore at least once a month.</li>
          </ul>
          <p>Full instructions are in the <strong>README</strong>, section “Backup &amp; restore”.</p>
        </div>
      </Card>
    </div>
  );
}
