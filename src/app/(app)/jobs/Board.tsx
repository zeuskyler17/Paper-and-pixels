'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { JOB_COLUMNS, JOB_STATUS } from '@/lib/labels';
import { assignWorker, moveJob, takeJob } from './actions';
import { ReleaseOrderButton } from '@/components/ReleaseOrderButton';

export type JobCard = {
  id: number;
  status: string;
  orderId: number;
  orderNo: string;
  customer: string;
  product: string;
  category: string;
  quantity: number;
  size: string | null;
  specs: string[];
  specsNotes: string | null;
  due: string | null;
  overdue: boolean;
  elapsedDays: number;
  assignedToId: number | null;
  assignedName: string | null;
  /** "Jc · Oct 17, 2026, 9:30 AM" — who delegated the job to the worker. */
  assignedBy: string | null;
  /** Latest status move: who moved it, to what, when. */
  lastMove: { to: string; by: string; at: string } | null;
  /** Completed job whose order is not released yet: balance owed and whether all the order's jobs are done. */
  release: { balance: number; ready: boolean } | null;
};

type Worker = { id: number; name: string };

const NEXT_LABEL: Record<string, string> = {
  PENDING: 'Start ▶',
  IN_PROCESS: 'To QC ▶',
  QUALITY_CHECK: 'Complete ✓',
};

const COLUMN_STYLE: Record<string, string> = {
  PENDING: 'border-t-slate-400',
  IN_PROCESS: 'border-t-blue-500',
  QUALITY_CHECK: 'border-t-purple-500',
  COMPLETED: 'border-t-emerald-500',
  CANCELLED: 'border-t-red-500',
};

const VIEW_KEY = 'pp_jobs_view';

export function Board({ jobs, workers, canAssign, canRelease = false, showCancelled }: {
  jobs: JobCard[]; workers: Worker[]; canAssign: boolean; canRelease?: boolean; showCancelled: boolean;
}) {
  const [view, setView] = useState<'board' | 'list'>('board');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === 'list' || v === 'board') setView(v);
      else if (window.matchMedia('(max-width: 640px)').matches) setView('list');
    } catch { /* storage unavailable */ }
  }, []);

  function changeView(v: 'board' | 'list') {
    setView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  }

  function run(id: number, fn: () => Promise<{ error?: string }>) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.error) setError(res.error);
      } catch {
        setError('Could not save. Check your connection and try again.');
      } finally {
        setBusyId(null);
      }
    });
  }

  const move = (job: JobCard, to: string) => {
    if (job.status === to) return;
    run(job.id, () => moveJob(job.id, to));
  };
  const assign = (job: JobCard, workerId: string) => run(job.id, () => assignWorker(job.id, workerId ? Number(workerId) : null));

  const columns: string[] = [...JOB_COLUMNS, ...(showCancelled ? ['CANCELLED'] : [])];
  const byStatus = (s: string) => jobs.filter((j) => j.status === s);

  const renderCard = (job: JobCard) => (
    <JobCardView
      key={job.id}
      job={job}
      workers={workers}
      canAssign={canAssign}
      canRelease={canRelease}
      busy={busyId === job.id}
      draggable={view === 'board' && job.status !== 'CANCELLED'}
      onDragStart={() => setDragId(job.id)}
      onDragEnd={() => { setDragId(null); setOverCol(null); }}
      onMove={(to) => move(job, to)}
      onAssign={(w) => assign(job, w)}
      onTake={() => run(job.id, () => takeJob(job.id))}
    />
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {(['board', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changeView(v)}
              className={`rounded px-3 py-1 font-medium ${view === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {v === 'board' ? 'Board' : 'List'}
            </button>
          ))}
        </div>
        {view === 'board' && <span className="hidden text-xs text-slate-500 md:inline">Drag cards between columns, or use the buttons on each card.</span>}
      </div>

      {error && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-semibold" aria-label="Dismiss">×</button>
        </div>
      )}

      {view === 'board' ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="grid auto-cols-[minmax(16rem,1fr)] grid-flow-col gap-3">
            {columns.map((col) => {
              const items = byStatus(col);
              const droppable = col !== 'CANCELLED' && dragId !== null;
              return (
                <section
                  key={col}
                  onDragOver={(e) => { if (droppable) { e.preventDefault(); setOverCol(col); } }}
                  onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = Number(e.dataTransfer.getData('text/plain'));
                    const job = jobs.find((j) => j.id === id);
                    setOverCol(null);
                    setDragId(null);
                    if (job && col !== 'CANCELLED') move(job, col);
                  }}
                  className={`flex min-h-[12rem] flex-col rounded-md border border-t-[3px] bg-slate-200/40 ${COLUMN_STYLE[col]} ${overCol === col ? 'ring-2 ring-brand-500' : ''}`}
                >
                  <h2 className="flex items-center justify-between px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-slate-700">
                    {JOB_STATUS[col]}
                    <span className="rounded-full bg-white px-2 text-xs text-slate-600">{items.length}</span>
                  </h2>
                  <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                    {items.length === 0 ? <p className="px-1 py-4 text-center text-xs text-slate-400">No jobs</p> : items.map(renderCard)}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {columns.map((col) => {
            const items = byStatus(col);
            return (
              <section key={col}>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-slate-700">{JOB_STATUS[col]} <span className="text-slate-500">({items.length})</span></h2>
                {items.length === 0 ? <p className="text-xs text-slate-400">No jobs</p> : (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{items.map(renderCard)}</div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function JobCardView({ job, workers, canAssign, canRelease, busy, draggable, onDragStart, onDragEnd, onMove, onAssign, onTake }: {
  job: JobCard; workers: Worker[]; canAssign: boolean; canRelease: boolean; busy: boolean; draggable: boolean;
  onDragStart: () => void; onDragEnd: () => void; onMove: (to: string) => void; onAssign: (workerId: string) => void; onTake: () => void;
}) {
  // A worker looking at an unassigned job: they can claim it, but not move it until it is theirs.
  const claimable = !canAssign && job.assignedToId === null && job.status === 'PENDING';
  const idx = (JOB_COLUMNS as readonly string[]).indexOf(job.status);
  const next = idx >= 0 && idx < JOB_COLUMNS.length - 1 ? JOB_COLUMNS[idx + 1] : null;
  const prev = idx > 0 ? JOB_COLUMNS[idx - 1] : null;
  const closed = job.status === 'CANCELLED';
  const notes = job.specsNotes && job.specsNotes.length > 90 ? job.specsNotes.slice(0, 90) + '…' : job.specsNotes;

  return (
    <article
      draggable={draggable && !busy}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(job.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      className={`rounded-md border bg-white p-3 text-sm shadow-sm ${job.overdue ? 'border-2 border-red-500' : 'border-slate-200'} ${busy ? 'opacity-60' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/jobs/${job.id}`} className="link font-mono text-[12.5px]">{job.orderNo}</Link>
        <span className="text-xs text-slate-500" title="Days since the job was created">{job.elapsedDays}d</span>
      </div>
      <div className="text-xs text-slate-600">{job.customer}</div>
      <div className="mt-1 font-medium">{job.quantity} × {job.product}</div>
      <div className="text-xs text-slate-500">{job.category}{job.size ? ` · ${job.size}` : ''}</div>
      {job.specs.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
          {job.specs.slice(0, 5).map((s, i) => <li key={i}>{s}</li>)}
          {job.specs.length > 5 && <li className="text-slate-400">+{job.specs.length - 5} more</li>}
        </ul>
      )}
      {notes && <p className="mt-1 text-xs italic text-slate-500">{notes}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={job.overdue ? 'font-semibold text-red-600' : 'text-slate-600'}>
          Due: {job.due ?? '—'}{job.overdue && ' (overdue)'}
        </span>
        {!canAssign && <span className={job.assignedName ? 'text-slate-600' : 'font-semibold text-amber-700'}>Worker: {job.assignedName ?? 'Unassigned — available'}</span>}
      </div>

      {(job.assignedBy || job.lastMove) && (
        <div className="mt-2 space-y-0.5 border-t border-dashed border-slate-200 pt-1.5 text-[11px] leading-snug text-slate-500">
          {job.assignedBy && <div><span className="font-semibold text-slate-600">Assigned by</span> {job.assignedBy}</div>}
          {job.lastMove && <div><span className="font-semibold text-slate-600">{job.lastMove.to === 'IN_PROCESS' ? 'Started' : job.lastMove.to === 'COMPLETED' ? 'Completed' : job.lastMove.to === 'CANCELLED' ? 'Cancelled' : `Moved to ${JOB_STATUS[job.lastMove.to] ?? job.lastMove.to}`} by</span> {job.lastMove.by} · {job.lastMove.at}</div>}
        </div>
      )}

      {canAssign && !closed && job.status !== 'COMPLETED' ? (
        <select
          aria-label="Assigned worker"
          value={job.assignedToId ?? ''}
          disabled={busy}
          onChange={(e) => onAssign(e.target.value)}
          className="input mt-2 py-1 text-xs"
        >
          <option value="">— Unassigned —</option>
          {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          {job.assignedToId && !workers.some((w) => w.id === job.assignedToId) && (
            <option value={job.assignedToId}>{job.assignedName ?? 'Inactive user'}</option>
          )}
        </select>
      ) : canAssign ? (
        <div className="mt-1 text-xs text-slate-600">Worker: {job.assignedName ?? 'Unassigned'}</div>
      ) : null}

      {claimable && !closed && (
        <button type="button" disabled={busy} onClick={onTake} className="btn-primary btn-sm mt-2 w-full">✋ Take this job</button>
      )}

      {!closed && !claimable && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {prev && <button type="button" disabled={busy} onClick={() => onMove(prev)} className="btn-secondary btn-sm" title={`Back to ${JOB_STATUS[prev]}`}>◀</button>}
          {next && <button type="button" disabled={busy} onClick={() => onMove(next)} className="btn-primary btn-sm">{NEXT_LABEL[job.status]}</button>}
          <select
            aria-label="Move to"
            value=""
            disabled={busy}
            onChange={(e) => { if (e.target.value) onMove(e.target.value); }}
            className="input ml-auto w-auto py-1 text-xs"
          >
            <option value="">Move to…</option>
            {JOB_COLUMNS.filter((c) => c !== job.status).map((c) => <option key={c} value={c}>{JOB_STATUS[c]}</option>)}
          </select>
        </div>
      )}
      {canRelease && job.release && (
        <ReleaseOrderButton orderId={job.orderId} orderNo={job.orderNo} balance={job.release.balance} ready={job.release.ready} className="mt-2" />
      )}
    </article>
  );
}
