// Presentational building blocks (server-component safe).
import Link from 'next/link';
import { TONE, type Tone } from '@/lib/labels';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-slate-300/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight sm:text-[24px]">{title}</h1>
        {subtitle && <div className="mt-1 text-[13px] text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex min-h-[44px] items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
          {title && (
            <h2 className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-700">
              <span aria-hidden className="h-3 w-[3px] shrink-0 bg-brand-600" />
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const toneClass: Record<Tone, { chip: string; dot: string }> = {
  gray: { chip: 'bg-slate-100 text-slate-700 ring-slate-300/70', dot: 'bg-slate-400' },
  blue: { chip: 'bg-sky-50 text-sky-800 ring-sky-300/70', dot: 'bg-sky-500' },
  amber: { chip: 'bg-amber-50 text-amber-800 ring-amber-300/80', dot: 'bg-amber-500' },
  green: { chip: 'bg-emerald-50 text-emerald-800 ring-emerald-300/70', dot: 'bg-emerald-500' },
  red: { chip: 'bg-red-50 text-red-800 ring-red-300/70', dot: 'bg-red-500' },
  purple: { chip: 'bg-violet-50 text-violet-800 ring-violet-300/70', dot: 'bg-violet-500' },
};

export function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: Tone }) {
  const t = toneClass[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] px-1.5 py-[3px] text-[10.5px] font-semibold uppercase leading-none tracking-[0.06em] ring-1 ring-inset ${t.chip}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {children}
    </span>
  );
}

/** Badge for an enum value using a label map, e.g. <StatusBadge value={o.status} labels={ORDER_STATUS} /> */
export function StatusBadge({ value, labels }: { value: string; labels: Record<string, string> }) {
  return <Badge tone={TONE[value] ?? 'gray'}>{labels[value] ?? value}</Badge>;
}

const statStrip = { red: 'bg-red-600', amber: 'bg-amber-500', green: 'bg-emerald-600', none: 'bg-slate-300' };
const statText = { red: 'text-red-700', amber: 'text-amber-700', green: 'text-emerald-700', none: 'text-slate-900' };

/** KPI tile: signal strip on top, uppercase label, large monospaced figure. */
export function Stat({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tone?: 'red' | 'amber' | 'green' }) {
  const k = tone ?? 'none';
  const body = (
    <div className={`card relative h-full overflow-hidden px-4 pb-3.5 pt-4 ${href ? 'transition group-hover:border-slate-400' : ''}`}>
      <span aria-hidden className={`absolute inset-x-0 top-0 h-[3px] ${statStrip[k]}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-slate-500">{label}</div>
        {href && <span aria-hidden className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">→</span>}
      </div>
      <div className={`mt-2 font-mono text-[24px] font-semibold leading-none tracking-tight tabular-nums ${statText[k]}`}>{value}</div>
      {hint && <div className="mt-2 text-[12px] leading-snug text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="group block">{body}</Link> : body;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-slate-300 bg-slate-50/60 px-6 py-8 text-center text-[13px] text-slate-500">
      {children}
    </div>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 overflow-x-auto sm:mx-0">{children}</div>;
}

export function Field({ label, children, className = '', hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Select({ name, options, defaultValue, required, placeholder, className = '' }: {
  name: string; options: { value: string | number; label: string }[]; defaultValue?: string | number | null;
  required?: boolean; placeholder?: string; className?: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ''} required={required} className={`input ${className}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function DL({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 text-[13px] sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 sm:border-b sm:border-slate-100 sm:py-2 sm:pr-6">{k}</dt>
          <dd className="border-b border-slate-100 pb-2 font-medium text-slate-800 sm:py-2">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** GET-form filter bar; children are inputs named after search params. */
export function FilterBar({ children, action }: { children: React.ReactNode; action?: string }) {
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-slate-50/70 p-2.5">
      {children}
      <button className="btn-dark" type="submit">Apply</button>
    </form>
  );
}
