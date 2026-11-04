'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Icon, type IconName } from './Icons';

export type NavItem = { href: string; label: string; icon: IconName };
export type NavSection = { title: string; items: NavItem[] };

function initials(name: string) {
  return name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function BrandMark({ compact = false, name, logo, color }: { compact?: boolean; name: string; logo: string | null; color: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? <img src={logo === '/logo.png' ? '/logo-128.png' : logo} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-full bg-white ring-1 ring-white/20" />
        : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white ring-1 ring-white/20" style={{ background: color }}>{name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>}
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold uppercase tracking-[0.14em] text-white">{name}</span>
        {!compact && <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Operations Suite</span>}
      </span>
    </Link>
  );
}

/** Light / dark switch: remembered in the pp_theme cookie for a year; flips the class on the app shell at once. */
function ThemeToggle({ initial, className = '' }: { initial: 'light' | 'dark'; className?: string }) {
  const [theme, setTheme] = useState(initial);
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.cookie = `pp_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    document.getElementById('app-shell')?.classList.toggle('theme-dark', next === 'dark');
    setTheme(next);
  };
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" onClick={flip} title={label} aria-label={label} className={className}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="h-[17px] w-[17px]" />
    </button>
  );
}

export function Nav({
  sections, userName, roleLabel, logout, today, showSearch, brand, theme,
}: {
  sections: NavSection[]; userName: string; roleLabel: string; logout: () => Promise<void>; today: string; showSearch: boolean;
  brand: { name: string; logo: string | null; color: string }; theme: 'light' | 'dark';
}) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const here = query ? `${pathname}?${query}` : pathname;
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Back: previous page in this tab, or the home page when there is no history (opened directly).
  const home = sections[0]?.items[0]?.href ?? '/';
  const showBack = pathname !== home;
  const goBack = () => { if (window.history.length > 1) router.back(); else router.push(home); };
  const all = sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })));
  // Highlight only the most specific matching item (e.g. /inventory/out, not also /inventory).
  // Items with a query string (the per-line production boards) match on path + query; a plain item
  // then steps aside when one of those matches.
  const matches = (href: string) => (href.includes('?') ? here === href || here.startsWith(href + '&') : pathname === href || pathname.startsWith(href + '/'));
  const queryHit = all.some((i) => i.href.includes('?') && matches(i.href));
  const current = all.filter((i) => matches(i.href) && (i.href.includes('?') || !queryHit)).sort((a, b) => b.href.length - a.href.length)[0];

  const links = (
    <nav className="flex flex-col gap-5">
      {sections.map((s) => (
        <div key={s.title}>
          <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{s.title}</div>
          <ul className="flex flex-col gap-px">
            {s.items.map((i) => {
              const on = current?.href === i.href;
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => setOpen(false)}
                    aria-current={on ? 'page' : undefined}
                    className={`group relative flex items-center gap-2.5 rounded-[3px] px-3 py-[7px] text-[13px] font-medium transition-colors ${
                      on ? 'bg-white/[0.11] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_6px_18px_-8px_rgba(0,0,0,0.7)] ring-1 ring-inset ring-white/[0.12]' : 'text-slate-300/80 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    <span aria-hidden className={`absolute inset-y-1 left-0 w-[3px] rounded-r ${on ? 'bg-pixel-500' : 'bg-transparent'}`} />
                    <Icon name={i.icon} className={`h-[17px] w-[17px] shrink-0 ${on ? 'text-pixel-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const userBlock = (
    <div className="flex items-center gap-2.5 border-t border-white/[0.08] px-3 pt-3">
      <Link href="/account" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-graphite-700 text-[11px] font-semibold text-slate-200 ring-1 ring-white/10">
        {initials(userName)}
      </Link>
      <Link href="/account" className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px] font-medium text-slate-100">{userName}</span>
        <span className="block truncate text-[11px] text-slate-400">{roleLabel}</span>
      </Link>
      <form action={logout}>
        <button title="Log out" aria-label="Log out" className="grid h-8 w-8 place-items-center rounded-[3px] text-slate-500 hover:bg-white/[0.06] hover:text-slate-200">
          <Icon name="logout" />
        </button>
      </form>
    </div>
  );

  const sidebarBody = (
    <>
      <div className="flex h-14 items-center border-b border-white/[0.08] px-4"><BrandMark {...brand} /></div>
      <div className="nav-scroll flex-1 overflow-y-auto px-2 py-4">{links}</div>
      <div className="pb-3">{userBlock}</div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="liquid-glass theme-light no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-hidden lg:flex">{sidebarBody}</aside>

      {/* Mobile top bar */}
      <header className="liquid-glass liquid-bar theme-light no-print sticky top-0 z-30 flex h-14 items-center justify-between overflow-hidden px-4 lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {showBack && (
            <button onClick={goBack} aria-label="Back" className="grid h-9 w-9 shrink-0 place-items-center rounded-[3px] text-slate-200 ring-1 ring-white/10 active:bg-white/10">
              <Icon name="chevron" className="h-5 w-5 rotate-180" />
            </button>
          )}
          <BrandMark compact {...brand} />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle initial={theme} className="grid h-9 w-9 place-items-center rounded-[3px] text-slate-300 ring-1 ring-white/10 active:bg-white/10" />
          <button onClick={() => setOpen(true)} className="grid h-9 w-9 place-items-center rounded-[3px] text-slate-300 ring-1 ring-white/10" aria-label="Open menu">
            <Icon name="menu" className="h-5 w-5" />
          </button>
        </div>
      </header>
      {open && (
        <div className="theme-light no-print fixed inset-0 z-50 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-graphite-950/50 backdrop-blur-sm" />
          <aside className="liquid-glass liquid-solid absolute left-0 top-0 flex h-full w-[17rem] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} className="absolute right-3 top-3.5 grid h-8 w-8 place-items-center text-slate-400" aria-label="Close menu">
              <Icon name="close" />
            </button>
            {sidebarBody}
          </aside>
        </div>
      )}

      {/* Desktop top bar */}
      <div className="no-print sticky top-0 z-20 hidden h-14 items-center justify-between gap-4 border-b border-slate-200/70 bg-surface/60 px-8 backdrop-blur-xl backdrop-saturate-150 lg:ml-60 lg:flex">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
          {showBack && (
            <button onClick={goBack} className="mr-2 inline-flex h-8 items-center gap-1 rounded-[3px] border border-slate-200 bg-surface px-2.5 text-[12px] font-semibold text-slate-700 shadow-panel hover:border-slate-300 hover:bg-slate-50">
              <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" /> Back
            </button>
          )}
          {current ? (
            <>
              <span className="font-semibold uppercase tracking-[0.1em] text-slate-500">{current.section}</span>
              <Icon name="chevron" className="h-3.5 w-3.5 text-slate-300" />
              <span className="truncate font-semibold text-slate-800">{current.label}</span>
            </>
          ) : <span className="font-semibold text-slate-800">{brand.name}</span>}
        </div>
        <div className="flex items-center gap-4">
          {showSearch && (
            <form action="/orders" method="get" className="relative">
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input name="q" placeholder="Find order no. or customer…" className="h-8 w-64 rounded-[3px] border border-slate-200 bg-field pl-8 pr-3 text-[12.5px] text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:bg-field focus:outline-none focus:ring-2 focus:ring-brand-600/15" />
            </form>
          )}
          <ThemeToggle initial={theme} className="grid h-8 w-8 place-items-center rounded-[3px] border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800" />
          <div className="hidden items-center gap-2 border-l border-slate-200 pl-4 text-[11.5px] xl:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
            <span className="font-semibold uppercase tracking-[0.1em] text-slate-500">San Carlos Shop</span>
            <span className="font-mono text-slate-400">{today}</span>
          </div>
        </div>
      </div>
    </>
  );
}
