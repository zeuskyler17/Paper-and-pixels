import { BRANCHES, initials } from '@/lib/branches';
import { BranchSignIn, type LoginBranch } from './BranchSignIn';

export const metadata = { title: 'Sign in' };

const CAPABILITIES = [
  ['Orders & point of sale', 'Quotes, job orders, payments, receipts'],
  ['Production control', 'Job tracking and turnaround'],
  ['Inventory & supply', 'Stock, cutting and purchasing'],
] as const;

/**
 * Sign-in: brand header on top, the sign-in card centred below it (one sliding box per branch, see
 * BranchSignIn). Dark gradient backdrop with drifting colour glows; everything rises in on load.
 * All motion stops when the device asks for reduced motion (globals.css).
 */
export default function LoginPage() {
  const branches: LoginBranch[] = BRANCHES.map((b) => ({ key: b.key, name: b.name, tagline: b.tagline, logo: b.logo, color: b.color, initials: initials(b.name) }));
  return (
    <main className="theme-dark relative isolate min-h-[100dvh] overflow-hidden bg-[#060a14] text-white">
      {/* Backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="login-glow absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand-600/45 blur-[120px]" />
        <div className="login-glow login-glow-2 absolute -bottom-48 right-[-10rem] h-[38rem] w-[38rem] rounded-full bg-pixel-500/30 blur-[130px]" />
        <div className="login-glow login-glow-3 absolute left-[38%] top-[30%] h-[22rem] w-[22rem] rounded-full bg-violet-600/25 blur-[110px]" />
        <div
          className="login-grid absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 100%)',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#060a14]/80" />
      </div>

      <div className="mx-auto flex min-h-[100dvh] max-w-5xl flex-col items-center px-4 py-6 sm:px-8 sm:py-8">
        {/* Header */}
        <header className="login-rise flex w-full flex-col items-center text-center">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Paper and Pixels" width={48} height={48} className="h-11 w-11 rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.08),0_8px_30px_-6px_rgba(25,169,238,0.55)] sm:h-12 sm:w-12" />
            <div className="text-left leading-tight">
              <div className="text-[15px] font-semibold uppercase tracking-[0.16em]">Paper &amp; Pixels</div>
              <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-white/50">Printing · Fabrication · San Carlos City</div>
            </div>
          </div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75 backdrop-blur-md">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Operations Suite
          </div>
          <h1 className="mt-3 text-[26px] font-semibold leading-[1.1] tracking-tight sm:text-[34px]">
            Welcome back. Let&apos;s bring{' '}
            <span className="login-shimmer bg-gradient-to-r from-pixel-300 via-[#7aaeff] to-violet-300 bg-clip-text text-transparent">today&apos;s orders to life.</span>
          </h1>
          <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-white/55">Every print, album and frame, from first order to final delivery, tracked in one place.</p>
        </header>

        {/* Sign-in card, centred */}
        <div className="flex w-full flex-1 items-center justify-center py-6">
          <div className="w-full max-w-[420px]">
            <BranchSignIn branches={branches} />
            <p className="login-rise mt-5 flex items-center justify-center gap-2 text-center text-[11.5px] text-white/45" style={{ animationDelay: '260ms' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden>
                <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6zM9 12l2 2 4-4" />
              </svg>
              Authorized personnel only. All activity is recorded in the audit log.
            </p>
          </div>
        </div>

        {/* Footer strip */}
        <footer className="w-full">
          <ul className="mx-auto hidden max-w-3xl grid-cols-3 gap-3 md:grid">
            {CAPABILITIES.map(([title, text], n) => (
              <li key={title} className="login-rise flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-md" style={{ animationDelay: `${340 + n * 90}ms` }}>
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-pixel-400 to-brand-500 shadow-[0_0_10px_rgba(62,195,245,0.7)]" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-white/90">{title}</div>
                  <div className="text-[12px] text-white/50">{text}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-center text-[11px] uppercase tracking-[0.14em] text-white/35">San Carlos City, Pangasinan · facebook.com/papernpixels</p>
        </footer>
      </div>
    </main>
  );
}
