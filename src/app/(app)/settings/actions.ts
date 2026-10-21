'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { DEFAULT_SETTINGS, getSettings, type Settings } from '@/lib/settings';
import { parseLatLng } from '@/lib/geo';

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
    if (next.shop_location && !parseLatLng(next.shop_location)) throw new Error('Shop location must be "latitude, longitude", e.g. 15.9285, 120.3487.');

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
