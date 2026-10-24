import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { parseDateInput, todayManila } from '@/lib/dates';
import { employeeName } from '@/lib/hr';
import { getSettings } from '@/lib/settings';
import { fmtClock, fmtSlot, parseBreakSchedule } from '@/lib/timekeeping';
import { ClockKiosk, type KioskEmployee } from './ClockKiosk';

export const metadata = { title: 'Time clock' };
export const dynamic = 'force-dynamic';

export default async function ClockPage() {
  await requireUser();
  const today = todayManila();
  const workDate = parseDateInput(today)!;
  const yesterday = new Date(workDate.getTime() - 86_400_000);

  // Only what the kiosk needs: name, position, and today's time in / out. No rates, pay or HR notes.
  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_LEAVE'] }, pinHash: { not: null } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true, firstName: true, lastName: true, nickname: true, position: true,
      timeEntries: { where: { workDate: { gte: yesterday } }, select: { workDate: true, timeIn: true, timeOut: true, dayType: true, breaks: { orderBy: { startAt: 'asc' }, select: { startAt: true, endAt: true } } } },
    },
  });

  const list: KioskEmployee[] = employees.map((e) => {
    const t = e.timeEntries.find((x) => x.workDate.getTime() === workDate.getTime());
    // Overnight shift from yesterday: still open (< 16 h), or closed today.
    const y = e.timeEntries.find((x) => x.workDate.getTime() !== workDate.getTime() && x.timeIn
      && (x.timeOut ? x.timeOut >= workDate : Date.now() - x.timeIn.getTime() < 16 * 3_600_000));
    const shown = t ?? y;
    return {
      id: e.id,
      name: employeeName(e),
      nickname: e.nickname,
      position: e.position,
      timeIn: shown?.timeIn ? `${fmtClock(shown.timeIn)}${shown === y ? ' (yesterday)' : ''}` : null,
      timeOut: shown?.timeOut ? fmtClock(shown.timeOut) : null,
      leave: t?.dayType === 'PAID_LEAVE',
      onBreak: !!shown && !shown.timeOut && shown.breaks.some((b) => !b.endAt),
      breaks: (shown?.breaks ?? []).map((b) => `${fmtClock(b.startAt)}–${b.endAt ? fmtClock(b.endAt) : '…'}`).join(', ') || null,
    };
  });

  const settings = await getSettings();
  const slots = parseBreakSchedule(settings.break_schedule).map(fmtSlot);
  return <ClockKiosk employees={list} breakSlots={slots} requirePhoto={settings.clock_require_photo !== 'false'} requireLocation={settings.clock_require_location !== 'false'} />;
}
