import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { prisma } from '@/lib/db';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Field, PageHeader, Select } from '@/components/ui';
import { refreshAllPoints, saveSettings } from './actions';
import { POINTS_RELEASED } from '@/lib/points';
import { PaymentAccounts } from './PaymentAccounts';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireUser('settings');
  const s = await getSettings();
  // Shared clock-in login: active logins not tied to one employee (cashier PC, shop phone…).
  const kioskLogins = await prisma.user.findMany({ where: { active: true, employee: null, accessRole: { isAdmin: false } }, orderBy: { name: 'asc' }, select: { name: true, username: true } });

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
            <Field label="Late grace period (minutes)" hint="Shop default: time-ins up to this many minutes after the shift start count as on time. 0 = no grace period. Each employee can have their own (Employee → Late grace).">
              <input name="late_grace_minutes" type="number" min={0} max={60} step={1} defaultValue={s.late_grace_minutes} className="input" required />
            </Field>
            <Field label="Break schedule" hint="Break times for the time clock (Start break / End break), comma-separated. Minutes beyond each break's length count as over-break (undertime).">
              <input name="break_schedule" defaultValue={s.break_schedule} className="input" placeholder="10:00-10:15, 12:00-13:00, 15:00-15:15" />
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
            {POINTS_RELEASED ? (<>
            <div className="sm:col-span-2 mt-2 border-t border-slate-100 pt-3">
              <div className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-700">Loyalty points promo</div>
              <p className="mt-0.5 text-xs text-slate-500">Customers earn points on payments received and use them as pesos off new orders. Orders with a special customer discount earn no points. Branch transfers never earn.</p>
            </div>
            <Field label="Points promo" hint="Off: nobody earns or uses points and the points screens are hidden. Balances are kept.">
              <Select name="points_enabled" defaultValue={s.points_enabled} required options={[{ value: 'true', label: 'ON — promo launched' }, { value: 'false', label: 'OFF — promo stopped' }]} />
            </Field>
            <Field label="Earn: every ₱ paid" hint="Pesos below a full step carry over to the customer's next payment.">
              <div className="flex items-center gap-2">
                <input name="points_step" type="number" min={1} step={1} defaultValue={s.points_step} className="input num w-28" required />
                <span className="text-sm text-slate-600">=</span>
                <input name="points_per_step" type="number" min={1} step={1} defaultValue={s.points_per_step} className="input num w-20" required />
                <span className="text-sm text-slate-600">points</span>
              </div>
            </Field>
            <Field label="Use: 1 point = ₱ off" hint="No minimum — any number of points can be used.">
              <input name="point_value" type="number" min={0.01} step={0.01} defaultValue={s.point_value} className="input num w-28" required />
            </Field>
            <Field label="Most points one customer can use per week" hint="Monday to Sunday. 0 = no limit.">
              <input name="points_redeem_week_cap" type="number" min={0} step={1} defaultValue={s.points_redeem_week_cap} className="input num w-28" required />
            </Field>
            </>) : (<>
              {/* Points promo not released yet: keep its saved values unchanged. */}
              {(['points_enabled', 'points_step', 'points_per_step', 'point_value', 'points_redeem_week_cap'] as const).map((k) => <input key={k} type="hidden" name={k} value={s[k]} />)}
            </>)}
            <Field label="Shared clock-in login" hint="Everyone may time in / out while this login is open (e.g. the cashier PC or a shop phone). Punches made from it never show buddy-punching warnings.">
              <Select
                name="clock_kiosk_username"
                defaultValue={s.clock_kiosk_username}
                options={[{ value: '', label: '— none —' }, ...kioskLogins.map((u) => ({ value: u.username, label: `${u.name} (${u.username})` }))]}
              />
            </Field>
            <Field label="Shop location (lat, lng)" hint="Optional. Paste from Google Maps (right-click the shop → copy the numbers), e.g. 15.9285, 120.3487. Timekeeping then shows how far from the shop each punch was.">
              <input name="shop_location" defaultValue={s.shop_location} className="input" placeholder="15.9285, 120.3487" />
            </Field>
          </div>
          <SubmitButton>Save settings</SubmitButton>
        </ActionForm>
      </Card>

      {POINTS_RELEASED && <Card title="Refresh loyalty points">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Start the points over: <b>every customer goes back to 0 points</b> and any carry-over is cleared. Use this when you start a new promo period. The history stays in each customer&apos;s points list and the audit log.</p>
          <ActionForm action={refreshAllPoints} confirm="Refresh points? Every customer's points go back to 0. This cannot be undone.">
            <SubmitButton className="btn-secondary">Refresh points</SubmitButton>
          </ActionForm>
        </div>
      </Card>}

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
