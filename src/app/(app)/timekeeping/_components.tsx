// Server-safe presentational pieces for DTR tables (used by /timekeeping and /me).
import Link from 'next/link';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { DAY_TYPE, fmtClock, fmtMinutes } from '@/lib/timekeeping';
import { Badge, Stat, TableWrap } from '@/components/ui';
import { DTR_STATUS, type DtrStatus } from './_dtr';
import type { DtrRow, DtrTotals } from './_lib';
import { distanceM, fmtDistance, mapsUrl } from '@/lib/geo';

export type ShopPoint = { lat: number; lng: number } | null;
export type PunchFlagMap = Map<number, { in: string[]; out: string[]; cleared: { by: string; at: Date; note: string | null } | null }>;

export function DtrStatusBadge({ status }: { status: DtrStatus }) {
  const s = DTR_STATUS[status];
  if (status === 'NONE') return <span className="text-slate-400">—</span>;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function OtCell({ minutes, approved }: { minutes: number; approved: boolean }) {
  if (!minutes) return <span className="text-slate-400">—</span>;
  return (
    <span className={approved ? 'text-emerald-700' : 'text-slate-500'} title={approved ? 'Approved' : 'Not approved (not paid)'}>
      {fmtMinutes(minutes)} {approved ? '✓' : '✗'}
    </span>
  );
}

/** Time out shown with "+1" when it falls on the next calendar day (overnight). */
export function TimeOutCell({ date, timeOut }: { date: string; timeOut: Date | null }) {
  if (!timeOut) return <>—</>;
  const next = new Date(timeOut).getTime() - new Date(`${date}T00:00:00+08:00`).getTime() >= 86_400_000;
  return <>{fmtClock(timeOut)}{next && <sup className="ml-0.5 text-[10px] text-slate-500">+1</sup>}</>;
}

export function DtrTable({ rows, editHref, showPhotos = false, shop = null, flags }: { rows: DtrRow[]; editHref?: (date: string) => string; showPhotos?: boolean; shop?: ShopPoint; flags?: PunchFlagMap }) {
  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th><th>Day type</th><th className="text-right">In</th><th className="text-right">Out</th>
            <th className="text-right">Late</th><th className="text-right">Undertime</th><th className="text-right">Regular</th>
            <th className="text-right">OT</th><th>Status</th>{editHref && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const e = r.entry;
            const muted = r.status === 'REST_DAY' || r.status === 'NONE';
            return (
              <tr key={r.date} className={r.status === 'ABSENT' || r.status === 'INCOMPLETE' ? 'bg-red-50/40' : muted ? 'bg-slate-50/60' : ''}>
                <td className="whitespace-nowrap">
                  <span className="num">{fmtDate(r.date + 'T00:00:00+08:00')}</span> <span className="text-slate-500">{r.weekday}</span>
                </td>
                <td className="whitespace-nowrap">
                  {DAY_TYPE[r.dayType]}
                  {r.holiday && <div className="text-[11px] text-slate-500">{r.holiday.name}</div>}
                </td>
                <td className="text-right whitespace-nowrap">{fmtClock(e?.timeIn)}{showPhotos && <><Selfie photoId={e?.timeInPhotoId} time={e?.timeIn} source={e?.source} /><Pin lat={e?.timeInLat} lng={e?.timeInLng} accuracy={e?.timeInAccuracy} time={e?.timeIn} source={e?.source} shop={shop} /><Flag reasons={e ? flags?.get(e.id)?.in : undefined} cleared={e ? flags?.get(e.id)?.cleared : undefined} /></>}</td>
                <td className="text-right whitespace-nowrap"><TimeOutCell date={r.date} timeOut={e?.timeOut ?? null} />{showPhotos && <><Selfie photoId={e?.timeOutPhotoId} time={e?.timeOut} source={e?.source} /><Pin lat={e?.timeOutLat} lng={e?.timeOutLng} accuracy={e?.timeOutAccuracy} time={e?.timeOut} source={e?.source} shop={shop} /><Flag reasons={e ? flags?.get(e.id)?.out : undefined} cleared={e ? flags?.get(e.id)?.cleared : undefined} /></>}</td>
                <td className={`text-right whitespace-nowrap ${e?.lateMinutes ? 'text-amber-700' : ''}`}>{fmtMinutes(e?.lateMinutes ?? 0)}</td>
                <td className={`text-right whitespace-nowrap ${e?.undertimeMinutes ? 'text-amber-700' : ''}`}>{fmtMinutes(e?.undertimeMinutes ?? 0)}</td>
                <td className="text-right whitespace-nowrap">{fmtMinutes(e?.regularMinutes ?? 0)}</td>
                <td className="text-right whitespace-nowrap"><OtCell minutes={e?.overtimeMinutes ?? 0} approved={!!e?.otApproved} /></td>
                <td className="whitespace-nowrap"><DtrStatusBadge status={r.status} /></td>
                {editHref && (
                  <td className="whitespace-nowrap text-right">
                    {r.locked
                      ? <span className="text-[11px] uppercase tracking-wide text-slate-400" title="Inside a finalized / paid payroll">Locked</span>
                      : <Link href={editHref(r.date)} className="link text-[12px]">{e ? 'Edit' : 'Add'}</Link>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function DtrTotalsStats({ totals }: { totals: DtrTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Days present" value={totals.present} hint={totals.paidLeave ? `+ ${totals.paidLeave} paid leave` : undefined} />
      <Stat label="Absent" value={totals.absent} tone={totals.absent ? 'red' : undefined} hint={totals.incomplete ? `${totals.incomplete} incomplete` : undefined} />
      <Stat label="Regular hours" value={fmtMinutes(totals.regularMinutes)} />
      <Stat label="Late" value={fmtMinutes(totals.lateMinutes)} tone={totals.lateMinutes ? 'amber' : undefined} hint={totals.late ? `${totals.late} day${totals.late === 1 ? '' : 's'}` : undefined} />
      <Stat label="Undertime" value={fmtMinutes(totals.undertimeMinutes)} tone={totals.undertimeMinutes ? 'amber' : undefined} />
      <Stat label="Overtime" value={fmtMinutes(totals.otApproved)} tone={totals.otApproved ? 'green' : undefined} hint={totals.otUnapproved ? `${fmtMinutes(totals.otUnapproved)} not approved` : 'approved'} />
    </div>
  );
}

/**
 * Time-clock selfie thumbnail (ADMIN pages only — the image route refuses everyone else).
 * Shows "no photo" for clock punches without a selfie and "manual" for admin-entered times.
 */
export function Selfie({ photoId, time, source }: { photoId: number | null | undefined; time: Date | null | undefined; source?: string | null }) {
  if (!time) return null;
  if (photoId) {
    return (
      <a href={`/api/attachments/${photoId}`} target="_blank" rel="noreferrer" title="Open selfie" className="inline-block align-middle">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/attachments/${photoId}`} alt="Selfie" loading="lazy" className="ml-2 inline-block h-7 w-7 rounded-full object-cover ring-1 ring-slate-300 hover:ring-2 hover:ring-brand-500" />
      </a>
    );
  }
  return <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-slate-400">{source === 'MANUAL' ? 'manual' : 'no photo'}</span>;
}

/**
 * Where the device was at a punch (ADMIN pages only). Links to Google Maps; shows the distance from
 * the shop when "Shop location" is set in Settings. Nothing is shown for manual (admin-entered) times.
 */
export function Pin({ lat, lng, accuracy, time, source, shop }: {
  lat: number | null | undefined; lng: number | null | undefined; accuracy?: number | null; time: Date | null | undefined; source?: string | null; shop?: ShopPoint;
}) {
  if (!time || source === 'MANUAL') return null;
  if (lat == null || lng == null) return <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-slate-400">no GPS</span>;
  const d = shop ? distanceM(shop, { lat, lng }) : null;
  const far = d != null && d > 300 + (accuracy ?? 0);
  const title = `${lat.toFixed(5)}, ${lng.toFixed(5)}${accuracy != null ? ` (±${Math.round(accuracy)} m)` : ''} — open in Google Maps`;
  return (
    <a href={mapsUrl({ lat, lng })} target="_blank" rel="noreferrer" title={title}
      className={`ml-2 inline-flex items-center gap-0.5 rounded px-1 align-middle text-[10.5px] font-semibold ${far ? 'bg-red-50 text-red-700 ring-1 ring-red-200' : 'text-brand-700 hover:bg-brand-50'}`}>
      📍{d != null ? fmtDistance(d) : 'map'}
    </a>
  );
}

/** Buddy-punching warning next to a time (admin pages). Hover for the reason(s). */
export function Flag({ reasons, cleared }: { reasons?: string[]; cleared?: { by: string; at: Date; note: string | null } | null }) {
  if (!reasons || reasons.length === 0) return null;
  if (cleared) {
    return (
      <span title={`${reasons.join('\n')}\n\nChecked by ${cleared.by} · ${fmtDateTime(cleared.at)}${cleared.note ? ` — ${cleared.note}` : ''}`}
        className="ml-1.5 inline-flex cursor-help items-center rounded bg-slate-200 px-1.5 align-middle text-[10px] font-bold uppercase tracking-wide text-slate-600">✓ checked</span>
    );
  }
  return (
    <span title={reasons.join('\n') + '\n\nOpen the day (pencil / date link) to mark it as checked.'} className="ml-1.5 inline-flex cursor-help items-center rounded bg-red-600 px-1.5 align-middle text-[10px] font-bold uppercase tracking-wide text-white">⚠ check</span>
  );
}
