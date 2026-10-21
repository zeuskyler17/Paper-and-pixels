import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fmtDate, fmtDateTime, parseDateInput, todayManila, toDateInput } from '@/lib/dates';
import { employeeName } from '@/lib/hr';
import { DAY_TYPE, dayTypeFor, fmtClock, fmtMinutes, toTimeInput } from '@/lib/timekeeping';
import { Card, DL, Field, FilterBar, PageHeader } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { fmtHHMM, isDateStr, weekdayShort, workDaysLabel } from '../_dtr';
import { lockReason } from '../_lib';
import { OtCell } from '../_components';
import { getSettings } from '@/lib/settings';
import { distanceM, fmtDistance, mapsUrl, parseLatLng } from '@/lib/geo';
import { clearEntry, clearPunchFlags, markPaidLeave, reopenPunchFlags, saveEntry } from '../actions';
import { punchFlags } from '@/lib/clockFlags';

export const metadata = { title: 'Time record' };

type SP = Promise<{ employee?: string; date?: string }>;

export default async function EntryPage({ searchParams }: { searchParams: SP }) {
  await requireUser('hr');
  const sp = await searchParams;
  const empId = Number(sp.employee) || 0;
  const date = isDateStr(sp.date) ? sp.date : todayManila();

  if (!empId) {
    const employees = await prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, nickname: true },
    });
    return (
      <div>
        <PageHeader title="Add / edit time record" actions={<Link href="/timekeeping" className="btn-secondary">← Timekeeping</Link>} />
        <Card title="Choose employee and date">
          <FilterBar>
            <select name="employee" required className="input w-60" defaultValue="">
              <option value="" disabled>Select employee…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
            </select>
            <input type="date" name="date" defaultValue={date} className="input w-auto" required />
          </FilterBar>
        </Card>
      </div>
    );
  }

  const emp = await prisma.employee.findUnique({ where: { id: empId } });
  const shop = parseLatLng((await getSettings()).shop_location);
  if (!emp) notFound();
  const workDate = parseDateInput(date)!;
  const [entry, holiday, locked] = await Promise.all([
    prisma.timeEntry.findUnique({ where: { employeeId_workDate: { employeeId: emp.id, workDate } } }),
    prisma.holiday.findUnique({ where: { date: workDate } }),
    lockReason(prisma, emp.id, date),
  ]);
  const flag = entry ? (await punchFlags([entry])).get(entry.id) ?? null : null;
  const suggested = dayTypeFor(emp, date, holiday?.type);
  const outNextDay = !!entry?.timeOut && toDateInput(entry.timeOut) !== date;
  const back = `/timekeeping?employee=${emp.id}&from=${date.slice(0, 8)}01&to=${date}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${entry ? 'Edit' : 'Add'} time record`}
        subtitle={<>{employeeName(emp)} · {weekdayShort(date)}, {fmtDate(workDate)}</>}
        actions={<>
          <Link href={`/timekeeping?date=${date}`} className="btn-secondary">Daily view</Link>
          <Link href={back} className="btn-secondary">Employee DTR</Link>
        </>}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {locked ? (
            <Card title="Locked">
              <p className="text-[13px] text-red-700">{locked}</p>
            </Card>
          ) : (
            <Card title={entry ? 'Correct time record' : 'New time record'}>
              <ActionForm action={saveEntry.bind(null, emp.id, date)} className="grid gap-3 sm:grid-cols-2">
                <Field label="Time in">
                  <input type="time" name="timeIn" defaultValue={toTimeInput(entry?.timeIn)} className="input" />
                </Field>
                <Field label="Time out" hint="Leave blank if not yet timed out.">
                  <input type="time" name="timeOut" defaultValue={toTimeInput(entry?.timeOut)} className="input" />
                </Field>
                <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                  <input type="checkbox" name="outNextDay" defaultChecked={outNextDay} className="h-4 w-4" />
                  Time out is the next day (overnight shift)
                </label>
                <Field label="Break (minutes)" hint="Deducted only when 5+ hours were worked.">
                  <input type="number" name="breakMinutes" min={0} max={600} required defaultValue={entry?.breakMinutes ?? emp.breakMinutes} className="input" />
                </Field>
                <Field label="Day type" hint={`Suggested: ${DAY_TYPE[suggested]}${holiday ? ` (${holiday.name})` : ''}`}>
                  <select name="dayType" defaultValue={entry?.dayType ?? suggested} className="input">
                    {Object.entries(DAY_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                  <input type="checkbox" name="otApproved" defaultChecked={entry?.otApproved ?? false} className="h-4 w-4" />
                  Overtime approved (paid in payroll)
                </label>
                <Field label="Notes" className="sm:col-span-2">
                  <input name="notes" defaultValue={entry?.notes ?? ''} className="input" placeholder="Optional" />
                </Field>
                {entry && (
                  <Field label="Reason for change *" className="sm:col-span-2" hint="Required — saved in the audit log.">
                    <input name="reason" required className="input" placeholder="e.g. Forgot to time out; confirmed with supervisor" />
                  </Field>
                )}
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <SubmitButton>Save time record</SubmitButton>
                  <Link href={back} className="btn-secondary">Cancel</Link>
                </div>
              </ActionForm>
            </Card>
          )}

          {!locked && (
            <Card title="Quick actions">
              <div className="grid gap-4 sm:grid-cols-2">
                <ActionForm action={markPaidLeave.bind(null, emp.id, date)} className="space-y-2">
                  <p className="text-[12.5px] text-slate-600">Paid as a full regular day. Clears time in / out.</p>
                  {entry && <input name="reason" required className="input" placeholder="Reason (required)" />}
                  <SubmitButton className="btn-secondary">Mark as paid leave</SubmitButton>
                </ActionForm>
                {entry && (
                  <ActionForm action={clearEntry.bind(null, emp.id, date)} className="space-y-2" confirm="Delete this time record? The day will show as absent / rest day.">
                    <p className="text-[12.5px] text-slate-600">Deletes this day&apos;s record entirely.</p>
                    <input name="reason" required className="input" placeholder="Reason (required)" />
                    <SubmitButton className="btn-danger">Clear record</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Schedule">
            <DL items={[
              ['Employee', `${employeeName(emp)} · ${emp.employeeNo}`],
              ['Shift', `${fmtHHMM(emp.shiftStart)} – ${fmtHHMM(emp.shiftEnd)}`],
              ['Break', `${emp.breakMinutes} min`],
              ['Work days', workDaysLabel(emp.workDays)],
              ['Holiday', holiday ? `${holiday.name} (${holiday.type === 'REGULAR' ? 'regular' : 'special'})` : '—'],
            ]} />
          </Card>
          {entry && (
            <Card title="Current record">
              <DL items={[
                ['Time in', fmtClock(entry.timeIn)],
                ['Time out', entry.timeOut ? `${fmtClock(entry.timeOut)}${outNextDay ? ' (next day)' : ''}` : '—'],
                ['Day type', DAY_TYPE[entry.dayType]],
                ['Regular', fmtMinutes(entry.regularMinutes)],
                ['Late', fmtMinutes(entry.lateMinutes)],
                ['Undertime', fmtMinutes(entry.undertimeMinutes)],
                ['Overtime', <OtCell key="ot" minutes={entry.overtimeMinutes} approved={entry.otApproved} />],
                ['Source', entry.source === 'CLOCK' ? 'Time clock' : 'Manual (admin)'],
                ['Last change', fmtDateTime(entry.updatedAt)],
              ]} />
            </Card>
          )}
          {entry && (entry.timeIn || entry.timeOut) && (<>
            {flag && (
              <Card title="Time-clock check (buddy punching)" actions={flag.cleared ? <span className="text-xs font-semibold text-slate-500">✓ checked</span> : <span className="text-xs font-semibold text-red-700">⚠ needs a look</span>}>
                <ul className="mb-3 list-disc pl-5 text-[13px] text-slate-700">
                  {flag.in.map((r) => <li key={'i' + r}><b>Time in:</b> {r}</li>)}
                  {flag.out.map((r) => <li key={'o' + r}><b>Time out:</b> {r}</li>)}
                </ul>
                {flag.cleared ? (
                  <div className="space-y-2 text-[13px]">
                    <p>Checked by <b>{flag.cleared.by}</b> · {fmtDateTime(flag.cleared.at)}{flag.cleared.note ? <> — {flag.cleared.note}</> : null}</p>
                    <ActionForm action={reopenPunchFlags.bind(null, entry!.id)}><SubmitButton className="btn-secondary btn-sm">Re-open flag</SubmitButton></ActionForm>
                  </div>
                ) : (
                  <ActionForm action={clearPunchFlags.bind(null, entry!.id)} className="space-y-2">
                    <input name="note" className="input" maxLength={300} placeholder="Why it is OK (optional), e.g. shop tablet shared at the counter" />
                    <SubmitButton>Mark as checked — remove the flag</SubmitButton>
                    <p className="text-[11.5px] text-slate-500">Look at the two selfies above first. If someone really punched for another person, fix the time record instead (Add / edit entry) and note it under the employee's Incidents.</p>
                  </ActionForm>
                )}
              </Card>
            )}
            <Card title="Time-clock selfies & location">
              <div className="grid grid-cols-2 gap-3">
                {([['Time in', entry.timeIn, entry.timeInPhotoId, entry.timeInLat, entry.timeInLng, entry.timeInAccuracy], ['Time out', entry.timeOut, entry.timeOutPhotoId, entry.timeOutLat, entry.timeOutLng, entry.timeOutAccuracy]] as const).map(([label, at, photoId, lat, lng, acc]) => (
                  <figure key={label} className="text-center">
                    {photoId ? (
                      <a href={`/api/attachments/${photoId}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/attachments/${photoId}`} alt={`${label} selfie`} className="aspect-[4/3] w-full rounded object-cover ring-1 ring-slate-200" />
                      </a>
                    ) : (
                      <div className="grid aspect-[4/3] w-full place-items-center rounded border border-dashed border-slate-300 bg-slate-50 text-[12px] text-slate-400">
                        {at ? (entry.source === 'MANUAL' ? 'Entered manually' : 'No photo') : 'Not yet'}
                      </div>
                    )}
                    <figcaption className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label} · {fmtClock(at)}</figcaption>
                    {at && entry.source !== 'MANUAL' && (
                      <div className="mt-1 text-[12px]">
                        {lat != null && lng != null ? (
                          <a href={mapsUrl({ lat, lng })} target="_blank" rel="noreferrer" className="link">
                            📍 {shop ? `${fmtDistance(distanceM(shop, { lat, lng }))} from shop` : 'Open in Google Maps'}{acc != null ? ` (±${Math.round(acc)} m)` : ''}
                          </a>
                        ) : <span className="text-slate-400">No GPS location</span>}
                      </div>
                    )}
                  </figure>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] text-slate-500">Photos and GPS locations are taken by the time clock at the moment of each punch. Visible to admins only.{!shop && ' Set the shop location in Settings to see how far from the shop each punch was.'}</p>
            </Card>
          </>)}
        </div>
      </div>
    </div>
  );
}
