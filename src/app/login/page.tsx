import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { login } from './actions';
import { BRANCHES, initials } from '@/lib/branches';

export const metadata = { title: 'Sign in' };

const CAPABILITIES = [
  ['01', 'Orders & point of sale', 'Quotes, job orders, payments and acknowledgement receipts.'],
  ['02', 'Production control', 'Kanban job tracking, worker assignment and turnaround.'],
  ['03', 'Inventory & supply', 'Three-level stock, cutting, bills of materials and purchasing.'],
] as const;

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,1fr)]">
      {/* Brand panel */}
      <section
        className="relative hidden overflow-hidden bg-graphite-900 px-12 py-10 text-white lg:flex lg:flex-col"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      >
        <div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-pixel-500 via-brand-600 to-brand-800" />
        <div className="flex items-center gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Paper and Pixels" width={56} height={56} className="h-14 w-14 rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.06)]" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold uppercase tracking-[0.16em]">Paper &amp; Pixels</div>
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-slate-400">Printing · Fabrication · San Carlos City</div>
          </div>
        </div>

        <div className="my-auto max-w-lg py-16">
          <div className="mb-4 inline-flex items-center gap-2 rounded-[3px] border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Operations Suite
          </div>
          <h1 className="text-[40px] font-semibold leading-[1.08] tracking-tight text-white">
            Production &amp; operations<br />management.
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-slate-400">
            One system for every order, job, material and peso — from the counter to the workshop floor.
          </p>
          <ul className="mt-10 space-y-5">
            {CAPABILITIES.map(([n, title, text]) => (
              <li key={n} className="flex gap-4">
                <span className="font-mono text-[12px] font-medium text-pixel-400">{n}</span>
                <div>
                  <div className="text-[14px] font-semibold text-slate-100">{title}</div>
                  <div className="text-[13px] text-slate-400">{text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.08] pt-5 text-[11px] uppercase tracking-[0.14em] text-slate-500">
          <span>San Carlos City, Pangasinan</span>
          <span className="font-mono normal-case tracking-normal">facebook.com/papernpixels</span>
        </div>
      </section>

      {/* Sign-in */}
      <section className="flex flex-col">
        <div className="flex h-14 items-center gap-2.5 bg-graphite-900 px-5 lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-128.png" alt="Paper and Pixels" width={32} height={32} className="h-8 w-8 rounded-full bg-white" />
          <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white">Paper &amp; Pixels</span>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-[360px]">
            <div className="mb-8">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-700">Secure access</div>
              <h2 className="mt-2 text-[26px] font-semibold tracking-tight">Sign in to your account</h2>
              <p className="mt-1.5 text-[13.5px] text-slate-500">Pick your branch, then use the username and password given by the owner. Each branch has its own accounts.</p>
            </div>
            <ActionForm action={login} className="space-y-4">
              <fieldset>
                <legend className="label">Branch</legend>
                <div className="grid gap-2">
                  {BRANCHES.map((b, i) => (
                    <label key={b.key} className="flex cursor-pointer items-center gap-3 rounded-[4px] border border-slate-200 px-3 py-2.5 hover:border-slate-400 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50/60 has-[:checked]:ring-1 has-[:checked]:ring-brand-600">
                      <input type="radio" name="branch" value={b.key} defaultChecked={i === 0} className="accent-[#1452d9]" required />
                      {b.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.logo} alt="" width={28} height={28} className="h-7 w-7 rounded-full bg-white ring-1 ring-slate-200" />
                      ) : (
                        <span className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: b.color }}>{initials(b.name)}</span>
                      )}
                      <span className="min-w-0 leading-tight">
                        <span className="block text-[13.5px] font-semibold text-slate-900">{b.name}</span>
                        <span className="block text-[11px] text-slate-500">{b.tagline}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block">
                <span className="label">Username</span>
                <input name="username" className="input h-10" autoComplete="username" autoCapitalize="none" required autoFocus />
              </label>
              <label className="block">
                <span className="label">Password</span>
                <input name="password" type="password" className="input h-10" autoComplete="current-password" required />
              </label>
              <SubmitButton className="btn-primary h-10 w-full">Sign in</SubmitButton>
            </ActionForm>
            <p className="mt-8 border-t border-slate-200 pt-4 text-[11.5px] leading-relaxed text-slate-400">
              Authorized personnel only. All activity is recorded in the audit log.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
