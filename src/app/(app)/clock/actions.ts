'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { logActionError } from '@/lib/action';
import { parseDateInput } from '@/lib/dates';
import { getSettings } from '@/lib/settings';
import { clockBreak, clockPunch, verifyPin } from '@/lib/hr';
import { fmtClock } from '@/lib/timekeeping';
import { isGeoFix, type GeoFix } from '@/lib/geo';

export type PunchResponse =
  | { error: string }
  | { ok: { action: 'IN' | 'OUT'; name: string; time: string; lateMinutes: number; photo: boolean; location: boolean } };

const MAX_PHOTO_BYTES = 600 * 1024;
const MIN_PHOTO_BYTES = 3 * 1024; // a real camera frame; rejects blank/empty captures

/** Decode a "data:image/jpeg;base64,…" selfie from the kiosk camera. */
function decodeSelfie(dataUrl: string | null | undefined): { mime: string; data: Buffer } | null {
  if (!dataUrl) return null;
  const m = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('The selfie could not be read. Please try again.');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_PHOTO_BYTES) throw new Error('The selfie is too large. Please try again.');
  if (data.length < MIN_PHOTO_BYTES) throw new Error('The selfie came out blank. Check the camera and try again.');
  return { mime: m[1], data };
}

/**
 * Time-clock punch: verify the PIN, record time in (first punch) or time out (second), and attach
 * the selfie and GPS fix taken at that moment. When "clock_require_photo" / "clock_require_location" is on,
 * a punch without a photo / location is refused.
 */
export async function punch(employeeId: number, pin: string, photo?: string | null, location?: GeoFix | null): Promise<PunchResponse> {
  try {
    const user = await assertUser();
    if (!Number.isInteger(employeeId) || employeeId <= 0) return { error: 'Choose your name first.' };
    if (!/^\d{4,6}$/.test(pin)) return { error: 'Enter your 4–6 digit PIN.' };
    const settings = await getSettings();
    const requirePhoto = settings.clock_require_photo !== 'false';
    const requireLocation = settings.clock_require_location !== 'false';
    const selfie = decodeSelfie(photo);
    if (requirePhoto && !selfie) return { error: 'A selfie is required. Allow camera access and look at the camera, then press Enter again.' };
    const fix = location && isGeoFix(location) ? location : null;
    if (requireLocation && !fix) return { error: 'Your location is required. Allow location access for this site, wait for the location to show, then press Enter again.' };

    // A random id per device (cookie, 1 year) — lets the owner see when one phone punches for several people.
    const jar = await cookies();
    let deviceId = jar.get('pp_device')?.value ?? null;
    if (!deviceId || !/^[a-f0-9]{32}$/.test(deviceId)) {
      deviceId = randomBytes(16).toString('hex');
      jar.set('pp_device', deviceId, { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax', httpOnly: true });
    }
    const emp = await verifyPin(employeeId, pin).catch((e: unknown) => {
      throw new Error(e instanceof Error && e.message === 'Employee not found.' ? 'Wrong PIN.' : e instanceof Error ? e.message : 'Wrong PIN.');
    });
    if (emp.status !== 'ACTIVE' && emp.status !== 'ON_LEAVE') return { error: 'Wrong PIN.' };

    const r = await prisma.$transaction(async (tx) => {
      const r = await clockPunch(tx, emp, user.id);
      const entry = await tx.timeEntry.findUnique({
        where: { employeeId_workDate: { employeeId: emp.id, workDate: parseDateInput(r.workDate)! } },
        select: { id: true },
      });
      let photoId: number | null = null;
      if (selfie && entry) {
        const att = await tx.attachment.create({
          data: {
            filename: `selfie-${emp.employeeNo}-${r.workDate}-${r.action}.${selfie.mime === 'image/png' ? 'png' : selfie.mime === 'image/webp' ? 'webp' : 'jpg'}`,
            mimeType: selfie.mime, size: selfie.data.length, data: selfie.data, createdById: user.id,
          },
        });
        photoId = att.id;
      }
      if (entry) {
        await tx.timeEntry.update({
          where: { id: entry.id },
          data: r.action === 'IN'
            ? { timeInPhotoId: photoId ?? undefined, timeInLat: fix?.lat, timeInLng: fix?.lng, timeInAccuracy: fix?.accuracy ?? undefined, timeInByUserId: user.id, timeInDeviceId: deviceId }
            : { timeOutPhotoId: photoId ?? undefined, timeOutLat: fix?.lat, timeOutLng: fix?.lng, timeOutAccuracy: fix?.accuracy ?? undefined, timeOutByUserId: user.id, timeOutDeviceId: deviceId },
        });
      }
      const late = r.action === 'IN' && r.lateMinutes > 0 ? ` (late ${r.lateMinutes} min)` : '';
      await audit(tx, user.id, 'CLOCK', 'TimeEntry', entry?.id ?? emp.id, `${r.name} time ${r.action} ${fmtClock(r.at)}${late} · via login ${user.username}${photoId ? ' · selfie' : ' · no selfie'}${fix ? ` · GPS ${fix.lat.toFixed(5)},${fix.lng.toFixed(5)}${fix.accuracy != null ? ` ±${Math.round(fix.accuracy)}m` : ''}` : ' · no location'}`,
        { employeeId: emp.id, action: r.action, workDate: r.workDate, at: r.at.toISOString(), photoId, location: fix, byUserId: user.id, deviceId });
      return { ...r, photo: photoId !== null, location: fix !== null };
    });
    revalidatePath('/clock');
    revalidatePath('/timekeeping');
    revalidatePath('/me');
    return { ok: { action: r.action, name: r.name, time: fmtClock(r.at), lateMinutes: r.action === 'IN' ? r.lateMinutes : 0, photo: r.photo, location: r.location } };
  } catch (e) {
    logActionError(e);
    return { error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
}

export type BreakResponse =
  | { error: string }
  | { ok: { action: 'BREAK_START' | 'BREAK_END'; name: string; time: string; minutes: number; overMinutes: number; slot: string | null } };

/** Time-clock break punch: Start break / End break (PIN only; no selfie or location needed). */
export async function breakPunch(employeeId: number, pin: string): Promise<BreakResponse> {
  try {
    const user = await assertUser();
    if (!Number.isInteger(employeeId) || employeeId <= 0) return { error: 'Choose your name first.' };
    if (!/^\d{4,6}$/.test(pin)) return { error: 'Enter your 4–6 digit PIN.' };
    const deviceId = (await cookies()).get('pp_device')?.value ?? null;
    const emp = await verifyPin(employeeId, pin).catch((e: unknown) => {
      throw new Error(e instanceof Error && e.message === 'Employee not found.' ? 'Wrong PIN.' : e instanceof Error ? e.message : 'Wrong PIN.');
    });
    if (emp.status !== 'ACTIVE' && emp.status !== 'ON_LEAVE') return { error: 'Wrong PIN.' };
    const r = await prisma.$transaction(async (tx) => {
      const r = await clockBreak(tx, emp, user.id, deviceId && /^[a-f0-9]{32}$/.test(deviceId) ? deviceId : null);
      const what = r.action === 'BREAK_START' ? 'break start' : `break end (${r.minutes} min${r.overMinutes ? `, ${r.overMinutes} min over` : ''})`;
      await audit(tx, user.id, 'CLOCK', 'Employee', emp.id, `${r.name} ${what} ${fmtClock(r.at)} · via login ${user.username}`, { employeeId: emp.id, action: r.action, at: r.at.toISOString(), byUserId: user.id, deviceId });
      return r;
    });
    revalidatePath('/clock');
    revalidatePath('/timekeeping');
    revalidatePath('/me');
    return { ok: { action: r.action, name: r.name, time: fmtClock(r.at), minutes: r.minutes, overMinutes: r.overMinutes, slot: r.slot } };
  } catch (e) {
    logActionError(e);
    return { error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
}
