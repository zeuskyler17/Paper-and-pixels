'use client';

import { useEffect, useRef, useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { login } from './actions';

export type LoginBranch = { key: string; name: string; tagline: string; logo: string | null; color: string; initials: string };

// Glass form controls (frosted fields on the gradient backdrop). See .glass-input in globals.css for autofill.
const FIELD =
  'glass-input block h-11 w-full rounded-lg border border-white/15 bg-white/[0.06] px-3.5 text-[14px] text-white placeholder:text-white/35 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition duration-200 hover:border-white/25 ' +
  'focus:border-pixel-400/70 focus:bg-white/[0.09] focus:outline-none focus:ring-4 focus:ring-pixel-400/15';
const LABEL = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60';
const REMEMBER = 'pp_login_branch';
const EASE = 'cubic-bezier(.22,1,.36,1)';

/** Short name for the button and dots: "Paper & Pixels", "Keoni Studio", "KY Digital". */
const shortName = (name: string) => { const w = name.split(/\s+/); return w.length <= 3 ? name : w.slice(0, 2).join(' '); };

function Mark({ b, size }: { b: LoginBranch; size: number }) {
  const s = { width: size, height: size };
  return b.logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={b.logo} alt="" width={size} height={size} style={s} className="shrink-0 rounded-full bg-white ring-1 ring-white/20" />
  ) : (
    <span style={{ ...s, background: b.color, fontSize: size * 0.36 }} className="grid shrink-0 place-items-center rounded-full font-bold text-white ring-1 ring-white/20">{b.initials}</span>
  );
}

/**
 * Branch carousel: every branch is its own sign-in card. The chosen card sits in the middle; the others
 * peek out at the sides (smaller, dimmed, turned slightly) and slide in when tapped, swiped, or picked with
 * the arrows, the dots or the ← → keys. Each card is its own form with the branch fixed. The last branch
 * used on this device is remembered.
 */
export function BranchSignIn({ branches }: { branches: LoginBranch[] }) {
  const [i, setI] = useState(0);
  const [animate, setAnimate] = useState(false); // no slide on the first paint (restoring the remembered branch)
  const fields = useRef<(HTMLInputElement | null)[]>([]);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const len = branches.length;
  const fine = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  useEffect(() => {
    let at = 0;
    try {
      const saved = localStorage.getItem(REMEMBER);
      at = Math.max(0, branches.findIndex((b) => b.key === saved));
    } catch { /* storage blocked: start on the first branch */ }
    setI(at);
    // Desktop only: cursor in Username without scrolling (phones: no surprise keyboard).
    if (fine()) fields.current[at]?.focus({ preventScroll: true });
    // Turn the slide on just after the first paint (a timer, so it also works in a tab opened in the background).
    const t = setTimeout(() => setAnimate(true), 60);
    return () => clearTimeout(t);
  }, [branches]);

  const go = (n: number) => {
    const next = ((n % len) + len) % len;
    if (next === i) return;
    setI(next);
    try { localStorage.setItem(REMEMBER, branches[next].key); } catch { /* ignore */ }
    if (fine()) setTimeout(() => fields.current[next]?.focus({ preventScroll: true }), 420);
  };

  // ← → switch branches, except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') go(i + 1);
      if (e.key === 'ArrowLeft') go(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current; touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? i + 1 : i - 1);
  };

  /** Position of card n relative to the chosen one, wrapping around: … −1 (left), 0 (centre), +1 (right) … */
  const offset = (n: number) => { let d = (n - i + len) % len; if (d > len / 2) d -= len; return d; };
  const active = branches[i];

  return (
    <div className="w-full">
      {/* Stage: all cards share one grid cell; transforms place them side by side. */}
      <div
        className="relative mx-auto grid w-full max-w-[420px]"
        style={{ gridTemplateAreas: '"stack"' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        aria-roledescription="carousel"
        aria-label="Branches"
      >
        {/* Halo in the chosen branch's colour */}
        <div aria-hidden className="pointer-events-none absolute -inset-10 -z-10 rounded-[48px] opacity-70 blur-3xl transition-[background] duration-700" style={{ background: `radial-gradient(55% 55% at 50% 45%, ${active.color}66, transparent 70%)` }} />

        {branches.map((b, n) => {
          const d = offset(n);
          const on = d === 0;
          const far = Math.abs(d) > 1;
          return (
            <div
              key={b.key}
              className="login-rise relative [grid-area:stack]"
              style={{
                animationDelay: `${120 + Math.abs(d) * 110}ms`,
                zIndex: 10 - Math.abs(d),
              }}
            >
              <section
                id={`panel-${b.key}`}
                aria-label={`${b.name} sign in`}
                aria-hidden={!on}
                inert={!on}
                className="relative h-full motion-reduce:!transition-none"
                style={{
                  transform: `perspective(1400px) translateX(${d * 74}%) scale(${on ? 1 : 0.84}) rotateY(${d * -16}deg)`,
                  opacity: far ? 0 : on ? 1 : 0.42,
                  filter: on ? 'none' : 'saturate(.6) brightness(.85)',
                  transition: animate ? `transform .6s ${EASE}, opacity .5s ${EASE}, filter .5s ${EASE}` : 'none',
                  transformOrigin: 'center center',
                }}
              >
                <div aria-hidden className="absolute -inset-px rounded-[22px] bg-gradient-to-br from-white/25 via-white/5 to-white/15" />
                <div className={`relative h-full overflow-hidden rounded-[21px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl transition-colors duration-500 ${on ? 'bg-[#0b1222]/90' : 'bg-[#0b1222]/75'}`}>
                  {/* Branch colour strip + top highlight */}
                  <div aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, transparent, ${b.color}, transparent)` }} />
                  <div aria-hidden className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
                  <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-40 blur-2xl" style={{ background: b.color }} />

                  <div className="relative px-5 pb-6 pt-6 sm:px-7 sm:pb-7 sm:pt-7">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pixel-300">Branch sign in</span>
                      <span className="font-mono text-[11px] text-white/40">{n + 1} / {len}</span>
                    </div>
                    <div key={on && animate ? `on-${i}` : 'idle'} className={`mt-4 flex items-center gap-3.5 ${on && animate ? 'login-pop' : ''}`}>
                      <Mark b={b} size={50} />
                      <div className="min-w-0">
                        <h2 className="text-[21px] font-semibold leading-tight tracking-tight text-white">{b.name}</h2>
                        <p className="truncate text-[12.5px] text-white/55">{b.tagline}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[13px] leading-relaxed text-white/50">Use the username and password the owner gave you for this branch.</p>

                    <ActionForm action={login} className="mt-5">
                      <div className="space-y-4">
                        <input type="hidden" name="branch" value={b.key} />
                        <label className="block">
                          <span className={LABEL}>Username</span>
                          <input ref={(el) => { fields.current[n] = el; }} name="username" className={FIELD} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
                        </label>
                        <label className="block">
                          <span className={LABEL}>Password</span>
                          <input name="password" type="password" className={FIELD} autoComplete="current-password" required />
                        </label>
                        <SubmitButton className="btn h-11 w-full rounded-lg bg-gradient-to-r from-brand-600 via-[#2a7ff3] to-pixel-500 text-[14px] text-white shadow-[0_10px_30px_-8px_rgba(31,111,240,0.75)] transition duration-200 hover:brightness-110 active:brightness-95">
                          Sign in to {shortName(b.name)}
                        </SubmitButton>
                      </div>
                    </ActionForm>
                  </div>
                </div>
              </section>

              {/* A side card is one big button: tap it to slide it to the middle. */}
              {!on && !far && (
                <button
                  type="button"
                  onClick={() => go(n)}
                  aria-label={`Switch to ${b.name}`}
                  className="absolute inset-y-0 z-20 cursor-pointer rounded-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pixel-400"
                  style={{ left: d < 0 ? '-74%' : '74%', width: '100%', transform: 'scale(.84)' }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="login-rise mx-auto mt-6 flex max-w-[420px] items-center justify-between" style={{ animationDelay: '320ms' }}>
        <button type="button" onClick={() => go(i - 1)} aria-label="Previous branch" className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/[0.05] text-white/70 backdrop-blur-md transition hover:border-white/30 hover:bg-white/[0.1] hover:text-white">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1.5">
            {branches.map((b, n) => (
              <button
                key={b.key}
                type="button"
                onClick={() => go(n)}
                aria-label={`Show ${b.name}`}
                aria-current={n === i}
                className="grid h-6 place-items-center px-0.5"
              >
                <span className={`block h-2 rounded-full transition-all duration-500 motion-reduce:transition-none ${n === i ? 'w-7 bg-pixel-400 shadow-[0_0_10px_rgba(62,195,245,0.7)]' : 'w-2 bg-white/25 hover:bg-white/45'}`} />
              </button>
            ))}
          </div>
          <span key={active.key} className="login-pop text-[12px] font-semibold text-white/70">{shortName(active.name)}</span>
        </div>
        <button type="button" onClick={() => go(i + 1)} aria-label="Next branch" className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/[0.05] text-white/70 backdrop-blur-md transition hover:border-white/30 hover:bg-white/[0.1] hover:text-white">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
    </div>
  );
}
