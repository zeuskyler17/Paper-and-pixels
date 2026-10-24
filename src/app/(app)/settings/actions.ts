'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { DEFAULT_SETTINGS, getSettings, type Settings } from '@/lib/settings';
import { parseLatLng } from '@/lib/geo';
import { parseBreakSchedule } from '@/lib/timekeeping';

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
const MAX_LEN: Partial<Record<keyof Settings, number>> = { receipt_footer: 500 };

export async function saveSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('settings');
    const next = {} as Settings;
    for (const key of KEYS) {
      const v = key === 'receipt_footer' ? String(fd.get(key) ?? '').trim() : str(fd, key);
      if (v.length > (MAX_LEN[key] ?? 200)) throw new Error(`${key.replace(/_/g, ' ')} is too long.`);
      next[key] = v;
    }
    if (!next.shop_name) throw new Error('Shop name is required.');
    if (next.bom_deduct_on !== 'IN_PROCESS' && next.bom_deduct_on !== 'COMPLETED') throw new Error('Choose when materials are deducted.');
    if (!/^\d{1,2}$/.test(next.late_grace_minutes) || Number(next.late_grace_minutes) > 60) throw new Error('Late grace period must be 0–60 minutes.');
    if (next.clock_require_photo !== 'true' && next.clock_require_photo !== 'false') throw new Error('Choose whether the time clock requires a selfie.');
    if (next.clock_require_location !== 'true' && next.clock_require_location !== 'false') throw new Error('Choose whether the time clock requires a location.');
    if (next.break_schedule && parseBreakSchedule(next.break_schedule).length !== next.break_schedule.split(/[,;\n]+/).filter((p) => p.trim()).length) {
      throw new Error('Break schedule must look like 10:00-10:15, 12:00-13:00, 15:00-15:15 (24-hour times, start before end).');
    }
    if (next.points_enabled !== 'true' && next.points_enabled !== 'false') throw new Error('Choose whether the points promo is on or off.');
    for (const [k, label, min] of [['points_step', 'Pesos per earning step', 1], ['points_per_step', 'Points per step', 1], ['point_value', 'Peso value of one point', 0.01], ['points_redeem_week_cap', 'Weekly points limit', 0]] as const) {
      const n = Number(next[k]);
      if (next[k] === '' || !Number.isFinite(n) || n < min) throw new Error(`${label} must be a number of at least ${min}.`);
    }
    if (next.shop_location && !parseLatLng(next.shop_location)) throw new Error('Shop location must be "latitude, longitude", e.g. 15.9285, 120.3487.');

    if (next.clock_kiosk_username && !(await prisma.user.findFirst({ where: { username: next.clock_kiosk_username, active: true, employee: null } }))) throw new Error('Choose an active login that is not linked to an employee for the shared clock-in login.');

    const before = await getSettings();
    const changed = KEYS.filter((k) => before[k] !== next[k]);
    if (changed.length === 0) return { ok: 'No changes.' };

    await prisma.$transaction(async (tx) => {
      for (const key of changed) {
        await tx.setting.upsert({ where: { key }, update: { value: next[key] }, create: { key, value: next[key] } });
      }
      await audit(tx, user.id, 'UPDATE', 'Setting', 'shop', `Updated settings: ${changed.join(', ')}`, {
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, next[k]])),
      });
    });
    revalidatePath('/', 'layout');
    return { ok: 'Settings saved.' };
  });
}

/** Owner/admin: "Refresh points" — every customer back to 0 points (history kept in the points ledger). */
export async function refreshAllPoints(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('admin');
    const { resetAllPoints } = await import('@/lib/points');
    const r = await prisma.$transaction(async (tx) => {
      const r = await resetAllPoints(tx, user.id);
      await audit(tx, user.id, 'RESET', 'Points', 'all', `Refreshed loyalty points: ${r.customers} customer(s) set back to 0 (${r.points} points cleared)`, r);
      return r;
    });
    revalidatePath('/', 'layout');
    return { ok: r.customers ? `Points refreshed: ${r.customers} customer(s) back to 0.` : 'Points refreshed — nobody had points.' };
  });
}
