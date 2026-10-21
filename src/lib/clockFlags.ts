import 'server-only';
import { prisma } from './db';

/**
 * Buddy-punching checks for time-clock entries (admin pages only).
 *  - "login": the punch was made while another employee's login was active on the device.
 *  - "device": the same device punched for two different employees within a few minutes.
 * A kiosk login that is not linked to any employee (e.g. the shop PC's cashier login) never raises the login flag.
 */
export type PunchFlags = { in: string[]; out: string[]; cleared: { by: string; at: Date; note: string | null } | null };
const WINDOW_MIN = 10;

type EntryLike = {
  id: number; employeeId: number; timeIn: Date | null; timeOut: Date | null;
  timeInByUserId: number | null; timeOutByUserId: number | null; timeInDeviceId: string | null; timeOutDeviceId: string | null;
  flagsClearedAt?: Date | null; flagsClearedById?: number | null; flagsClearNote?: string | null;
};

/** Flags still needing attention (not yet marked as checked). */
export const openFlagCount = (m: Map<number, PunchFlags>) => [...m.values()].filter((f) => !f.cleared).reduce((n, f) => n + f.in.length + f.out.length, 0);

export async function punchFlags(entries: EntryLike[]): Promise<Map<number, PunchFlags>> {
  const out = new Map<number, PunchFlags>();
  if (entries.length === 0) return out;
  const userIds = [...new Set(entries.flatMap((e) => [e.timeInByUserId, e.timeOutByUserId, e.flagsClearedById ?? null]).filter((x): x is number => !!x))];
  const empIds = [...new Set(entries.map((e) => e.employeeId))];
  // Same-device check needs every punch of those days, not just the rows on screen.
  const days = [...new Set(entries.map((e) => (e.timeIn ?? e.timeOut)?.toISOString().slice(0, 10)).filter(Boolean))];
  const [users, emps, allThatDay] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, employee: { select: { id: true, firstName: true, lastName: true } } } }) : [],
    prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, userId: true } }),
    days.length ? prisma.timeEntry.findMany({
      where: { OR: days.flatMap((d) => { const s = new Date(`${d}T00:00:00Z`); const e = new Date(s.getTime() + 2 * 86_400_000); s.setTime(s.getTime() - 86_400_000); return [{ timeIn: { gte: s, lt: e } }, { timeOut: { gte: s, lt: e } }]; }) },
      select: { employeeId: true, timeIn: true, timeOut: true, timeInDeviceId: true, timeOutDeviceId: true, employee: { select: { firstName: true, lastName: true } } },
    }) : [],
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const empUser = new Map(emps.map((e) => [e.id, e.userId]));
  // device id -> punches (employee, time)
  const byDevice = new Map<string, { employeeId: number; name: string; at: Date }[]>();
  for (const e of allThatDay) {
    const name = `${e.employee.firstName} ${e.employee.lastName}`;
    if (e.timeInDeviceId && e.timeIn) (byDevice.get(e.timeInDeviceId) ?? byDevice.set(e.timeInDeviceId, []).get(e.timeInDeviceId)!).push({ employeeId: e.employeeId, name, at: e.timeIn });
    if (e.timeOutDeviceId && e.timeOut) (byDevice.get(e.timeOutDeviceId) ?? byDevice.set(e.timeOutDeviceId, []).get(e.timeOutDeviceId)!).push({ employeeId: e.employeeId, name, at: e.timeOut });
  }
  const check = (employeeId: number, at: Date | null, byUserId: number | null, deviceId: string | null): string[] => {
    const r: string[] = [];
    if (!at) return r;
    const u = byUserId ? userById.get(byUserId) : null;
    if (u && u.employee && u.employee.id !== employeeId && byUserId !== empUser.get(employeeId)) {
      r.push(`Punched from ${u.employee.firstName} ${u.employee.lastName}'s login`);
    }
    if (deviceId) {
      for (const p of byDevice.get(deviceId) ?? []) {
        const mins = Math.abs(p.at.getTime() - at.getTime()) / 60_000;
        if (p.employeeId !== employeeId && mins <= WINDOW_MIN) { r.push(`Same device as ${p.name} (${Math.round(mins)} min apart)`); break; }
      }
    }
    return r;
  };
  for (const e of entries) {
    const cleared = e.flagsClearedAt ? { by: (e.flagsClearedById && userById.get(e.flagsClearedById)?.name) || 'admin', at: e.flagsClearedAt, note: e.flagsClearNote ?? null } : null;
    const f: PunchFlags = { in: check(e.employeeId, e.timeIn, e.timeInByUserId, e.timeInDeviceId), out: check(e.employeeId, e.timeOut, e.timeOutByUserId, e.timeOutDeviceId), cleared };
    if (f.in.length || f.out.length) out.set(e.id, f);
  }
  return out;
}
