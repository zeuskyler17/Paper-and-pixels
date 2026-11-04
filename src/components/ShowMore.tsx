'use client';

import { useState } from 'react';

/**
 * Shows only the first 5 rows of a list or table; a button at the bottom expands it in place.
 * Mark the list (ul / tbody) inside with className "limit-list" — rows past the 5th are hidden by CSS
 * (globals.css), so server-rendered rows need no client copy.
 */
export function ShowMore({ count, children, noun = 'items' }: { count: number; children: React.ReactNode; noun?: string }) {
  const [open, setOpen] = useState(false);
  const extra = count - 5;
  return (
    <div className="limit-wrap" data-open={open}>
      {children}
      {extra > 0 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="group mt-2 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/60 text-[12.5px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
        >
          {open ? 'Show less' : `Show all ${count} ${noun}`}
          {!open && <span className="font-normal text-slate-500">(+{extra} more)</span>}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}
