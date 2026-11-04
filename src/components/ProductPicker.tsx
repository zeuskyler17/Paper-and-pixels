'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { peso } from '@/lib/money';

export type PickerProduct = { id: number; name: string; basePrice: number; pricingMode: string; categoryName: string; description?: string | null };

/** Lower-case, and "lay flat" / "layflat" / "8 x 10" / "8x10" all compare the same. */
const norm = (s: string) => s.toLowerCase().replace(/[×]/g, 'x').replace(/\s+/g, ' ').trim();
const squash = (s: string) => norm(s).replace(/[\s\-_.]/g, '');

/**
 * Type-to-search product picker (replaces a long <select>). Every word typed must appear in the product
 * name, its category or description — "lay 8x20", "frame a4", "print 5r". Results keep the price-list
 * grouping. Keyboard: ↑ ↓ to move, Enter to pick, Esc to close.
 */
export function ProductPicker({
  products, value, onChange, placeholder = 'Search product — e.g. lay flat 8x20, frame, 5R…', autoFocus = false,
}: {
  products: PickerProduct[]; value: number | null; onChange: (id: number | null) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const selected = value ? products.find((p) => p.id === value) ?? null : null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const matches = useMemo(() => {
    const words = norm(query).split(' ').filter(Boolean);
    if (!words.length) return products;
    return products.filter((p) => {
      const hay = `${p.name} ${p.categoryName} ${p.description ?? ''}`;
      const n = norm(hay), q = squash(hay);
      return words.every((w) => n.includes(w) || q.includes(squash(w)));
    });
  }, [products, query]);

  // Grouped by category, in the price list's order; flat index for keyboard movement.
  const groups = useMemo(() => {
    const g: [string, PickerProduct[]][] = [];
    for (const p of matches) { const e = g.find(([c]) => c === p.categoryName); if (e) e[1].push(p); else g.push([p.categoryName, [p]]); }
    return g;
  }, [matches]);
  const flat = useMemo(() => groups.flatMap(([, ps]) => ps), [groups]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => { if (!wrap.current?.contains(e.target as Node)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, [open]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (p: PickerProduct) => {
    onChange(p.id);
    setQuery('');
    setOpen(false);
    input.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { if (open && flat[active]) { e.preventDefault(); pick(flat[active]); } }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    else if (e.key === 'Tab') { setOpen(false); setQuery(''); }
  };

  const price = (p: PickerProduct) => `${peso(p.basePrice)}${p.pricingMode === 'PER_SQFT' ? '/sq ft' : ''}`;
  // Bold the typed words inside a product name.
  const mark = (name: string) => {
    const words = norm(query).split(' ').filter(Boolean).sort((a, b) => b.length - a.length);
    if (!words.length) return name;
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    return name.split(re).map((part, k) => (k % 2 ? <mark key={k} className="rounded-sm bg-brand-100 px-0.5 font-semibold text-brand-800">{part}</mark> : part));
  };

  let n = -1;
  return (
    <div ref={wrap} className="relative min-w-0 flex-1">
      <div className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
          <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5" />
        </svg>
        <input
          ref={input}
          role="combobox"
          aria-label="Product"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && flat[active] ? `${id}-${flat[active].id}` : undefined}
          autoFocus={autoFocus}
          className={`input pl-9 ${selected && !open ? 'pr-28 font-semibold' : 'pr-9'}`}
          placeholder={selected ? selected.name : placeholder}
          value={open ? query : selected?.name ?? ''}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKey}
          autoComplete="off"
          spellCheck={false}
        />
        {selected && !open && (
          <span className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 font-mono text-[12.5px] tabular-nums text-slate-500">{price(selected)}</span>
        )}
        {(selected || query) && (
          <button
            type="button"
            aria-label={query ? 'Clear search' : 'Clear product'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { if (query) { setQuery(''); input.current?.focus(); } else { onChange(null); input.current?.focus(); } }}
            className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden className="h-3.5 w-3.5"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-md border border-slate-200 bg-surface shadow-[0_16px_40px_-12px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
            <span>{query ? `${flat.length} match${flat.length === 1 ? '' : 'es'} for “${query.trim()}”` : `${products.length} products — type to search`}</span>
            <span className="hidden sm:inline">↑ ↓ to move · Enter to pick · Esc to close</span>
          </div>
          <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Products" className="max-h-[min(22rem,55vh)] overflow-y-auto py-1">
            {flat.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-slate-500">No product matches “{query.trim()}”. Try fewer or shorter words.</li>}
            {groups.map(([cat, ps]) => (
              <li key={cat} role="presentation">
                <div className="sticky top-0 z-10 bg-slate-50 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">{cat}</div>
                <ul role="group" aria-label={cat}>
                  {ps.map((p) => {
                    n += 1;
                    const k = n;
                    const on = k === active;
                    return (
                      <li
                        key={p.id}
                        id={`${id}-${p.id}`}
                        data-i={k}
                        role="option"
                        aria-selected={p.id === value}
                        onMouseEnter={() => setActive(k)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(p)}
                        className={`flex min-h-[40px] cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[13.5px] ${on ? 'bg-brand-50 text-slate-900' : 'text-slate-700'}`}
                      >
                        <span className="min-w-0 truncate">
                          {p.id === value && <span className="mr-1.5 text-brand-600" aria-hidden>✓</span>}
                          {mark(p.name)}
                        </span>
                        <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-slate-500">{price(p)}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
