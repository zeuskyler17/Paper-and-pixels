'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { punch, type PunchResponse } from './actions';
import { SelfieCamera, type CameraState, type SelfieHandle } from './SelfieCamera';
import { useGeolocation } from './useGeolocation';

export type KioskEmployee = {
  id: number; name: string; nickname: string | null; position: string;
  timeIn: string | null; timeOut: string | null; leave: boolean;
};

const TZ = 'Asia/Manila';
const timeFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const dateFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-center">
      <div className="font-mono text-[44px] font-semibold leading-none tracking-tight tabular-nums text-slate-900 sm:text-[64px]" suppressHydrationWarning>
        {now ? timeFmt.format(now) : ' '}
      </div>
      <div className="mt-2 text-[14px] font-medium uppercase tracking-[0.08em] text-slate-500 sm:text-[16px]" suppressHydrationWarning>
        {now ? dateFmt.format(now) : ' '}
      </div>
    </div>
  );
}

export function ClockKiosk({ employees, requirePhoto, requireLocation }: { employees: KioskEmployee[]; requirePhoto: boolean; requireLocation: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<KioskEmployee | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<PunchResponse, { ok: unknown }>['ok'] | null>(null);
  const [pending, startTransition] = useTransition();
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const camera = useRef<SelfieHandle>(null);
  const [camState, setCamState] = useState<CameraState>('starting');
  const [photo, setPhoto] = useState<string | null>(null);
  const cameraBlocksPunch = requirePhoto && camState !== 'ready';
  // GPS is watched while a name is selected; the fix is read at the moment of the punch.
  const geo = useGeolocation(selected !== null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return employees;
    return employees.filter((e) => `${e.name} ${e.nickname ?? ''} ${e.position}`.toLowerCase().includes(s));
  }, [employees, q]);

  const backToGrid = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setSelected(null); setPin(''); setError(null); setResult(null); setQ(''); setPhoto(null); setCamState('starting');
  }, []);

  const submit = useCallback(() => {
    if (!selected || pending) return;
    if (pin.length < 4) { setError('Enter your 4–6 digit PIN.'); return; }
    // The selfie is taken right now, at the moment of the punch.
    const shot = camera.current?.capture() ?? null;
    if (requirePhoto && !shot) { setError('A selfie is required. Look at the camera and allow camera access, then press Enter.'); return; }
    if (requireLocation && !geo.fix) {
      setError(geo.state === 'denied' ? 'Location is blocked. Allow location access for this site in the browser, then press Enter.'
        : geo.state === 'unavailable' ? 'This device cannot give its location. Ask the admin to use another device or turn off the location requirement.'
        : 'Still getting your location — wait a moment, then press Enter.');
      return;
    }
    const p = pin;
    setPin('');
    startTransition(async () => {
      const res = await punch(selected.id, p, shot, geo.fix);
      if ('error' in res) { setError(res.error); return; }
      setError(null);
      setPhoto(res.ok.photo ? shot : null);
      setResult(res.ok);
      router.refresh();
      resetTimer.current = setTimeout(backToGrid, 4000);
    });
  }, [selected, pin, pending, router, backToGrid, requirePhoto, requireLocation, geo.fix, geo.state]);

  const press = useCallback((d: string) => {
    setError(null);
    setPin((p) => (p.length >= 6 ? p : p + d));
  }, []);

  // Physical keyboard: digits, Backspace, Enter, Escape.
  useEffect(() => {
    if (!selected || result) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); setPin((p) => p.slice(0, -1)); }
      else if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); backToGrid(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, result, press, submit, backToGrid]);

  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="card px-4 py-6 sm:py-8">
        <LiveClock />
      </div>

      {result ? (
        <button
          type="button"
          onClick={backToGrid}
          className={`block w-full rounded-md px-6 py-10 text-center text-white shadow-panel ${result.action === 'IN' ? 'bg-emerald-600' : 'bg-graphite-800'}`}
        >
          <div className="text-[13px] font-semibold uppercase tracking-[0.12em] opacity-80">{result.action === 'IN' ? 'Time in recorded' : 'Time out recorded'}</div>
          <div className="mt-2 text-[28px] font-semibold sm:text-[36px]">{result.name}</div>
          <div className="mt-3 font-mono text-[48px] font-semibold leading-none tabular-nums sm:text-[64px]">
            {result.action} · {result.time}
          </div>
          {result.lateMinutes > 0 && (
            <div className="mt-4 inline-block rounded bg-white/15 px-3 py-1 text-[16px] font-semibold">Late {result.lateMinutes} min</div>
          )}
          {photo && (
            <div className="mt-5 flex items-center justify-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="Selfie taken at this punch" className="h-20 w-20 rounded-full object-cover ring-4 ring-white/30" />
              <span className="text-[13px] font-semibold uppercase tracking-wide opacity-85">Photo recorded</span>
            </div>
          )}
          {result.location && <div className="mt-3 text-[13px] font-semibold uppercase tracking-wide opacity-85">📍 Location recorded</div>}
          <div className="mt-5 text-[12px] opacity-70">Tap to continue</div>
        </button>
      ) : selected ? (
        <div className="card mx-auto grid max-w-3xl items-start gap-5 p-5 sm:grid-cols-2">
          <div>
            <SelfieCamera ref={camera} onState={setCamState} />
            <p className="mt-2 text-center text-[12px] text-slate-500">
              {requirePhoto ? 'Look at the camera — your photo is taken when you press Enter.' : 'A photo is taken when you press Enter (if a camera is available).'}
            </p>
            <p className={`mt-1 text-center text-[12px] font-semibold ${geo.state === 'ready' ? 'text-emerald-700' : geo.state === 'denied' || geo.state === 'unavailable' ? (requireLocation ? 'text-red-600' : 'text-slate-500') : 'text-slate-500'}`}>
              {geo.state === 'ready' ? `📍 Location found${geo.fix?.accuracy != null ? ` (±${geo.fix.accuracy} m)` : ''}`
                : geo.state === 'denied' ? `📍 Location blocked${requireLocation ? ' — allow location access to time in / out' : ''}`
                : geo.state === 'unavailable' ? '📍 Location not available on this device'
                : '📍 Getting your location…'}
            </p>
          </div>
          <div>
          <div className="text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Enter PIN for</div>
            <div className="mt-1 text-[22px] font-semibold">{selected.name}</div>
            <div className="text-[13px] text-slate-500">{selected.position}</div>
          </div>
          <div className="my-5 flex h-8 items-center justify-center gap-3" aria-label={`${pin.length} digits entered`}>
            {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
              <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? 'bg-slate-900' : 'border-2 border-slate-300'}`} />
            ))}
          </div>
          {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-center text-[14px] font-medium text-red-700">{error}</p>}
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} type="button" disabled={pending} onClick={() => press(d)}
                className="h-16 rounded-md border border-slate-300 bg-white font-mono text-[26px] font-semibold shadow-panel active:bg-slate-100 disabled:opacity-50">
                {d}
              </button>
            ))}
            <button type="button" disabled={pending} onClick={() => { setPin(''); setError(null); }}
              className="h-16 rounded-md border border-slate-300 bg-slate-50 text-[14px] font-semibold uppercase tracking-wide text-slate-600 active:bg-slate-100">
              Clear
            </button>
            <button type="button" disabled={pending} onClick={() => press('0')}
              className="h-16 rounded-md border border-slate-300 bg-white font-mono text-[26px] font-semibold shadow-panel active:bg-slate-100 disabled:opacity-50">
              0
            </button>
            <button type="button" disabled={pending || pin.length < 4 || cameraBlocksPunch} onClick={submit}
              className="h-16 rounded-md bg-brand-600 text-[15px] font-semibold uppercase tracking-wide text-white active:bg-brand-800 disabled:opacity-50">
              {pending ? '…' : 'Enter'}
            </button>
          </div>
          <button type="button" onClick={backToGrid} className="btn-secondary mt-4 w-full">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-600">Tap your name</h2>
            {employees.length > 8 && (
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name…" className="input w-full sm:w-64" />
            )}
          </div>
          {employees.length === 0 ? (
            <p className="rounded border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center text-[14px] text-slate-500">
              No employees with a time-clock PIN yet. Ask the admin to set PINs on the employee records.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((e) => {
                const status = e.leave ? 'On leave' : e.timeOut ? 'Out' : e.timeIn ? 'In' : null;
                return (
                  <button key={e.id} type="button" onClick={() => { setSelected(e); setPin(''); setError(null); }}
                    className="card flex min-h-[96px] flex-col items-start justify-between p-4 text-left transition hover:border-brand-500 active:bg-brand-50">
                    <div>
                      <div className="text-[17px] font-semibold leading-tight">{e.name}</div>
                      <div className="mt-0.5 text-[12.5px] text-slate-500">{e.position}</div>
                    </div>
                    {status && (
                      <span className={`mt-2 text-[11px] font-semibold uppercase tracking-wide ${status === 'In' ? 'text-emerald-700' : 'text-slate-500'}`}>{status}</span>
                    )}
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="col-span-full text-[13px] text-slate-500">No match.</p>}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="flex min-h-[44px] items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <span aria-hidden className="h-3 w-[3px] bg-brand-600" />
          <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-700">Today</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Employee</th><th className="text-right">Time in</th><th className="text-right">Time out</th></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td className="text-right whitespace-nowrap">{e.leave ? 'Paid leave' : e.timeIn ?? '—'}</td>
                  <td className="text-right whitespace-nowrap">{e.leave ? '' : e.timeOut ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
