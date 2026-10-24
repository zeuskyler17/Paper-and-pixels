import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { addDays, fmtDateTime, startOfMonthManila, todayManila } from '@/lib/dates';
import { PrintButton } from '@/components/PrintButton';
import { Card, FilterBar, PageHeader } from '@/components/ui';
import { ANY_REPORT, REPORTS, buildReport, canSeeReport, isReportKey, mondayOf, normalizeParams } from '../_data';
import { ReportTable } from '../_ReportTable';

type Params = Promise<{ report: string }>;
type SP = Promise<{ from?: string; to?: string; group?: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { report } = await params;
  return { title: isReportKey(report) ? REPORTS[report].title : 'Report' };
}

function presets(): { label: string; from: string; to: string }[] {
  const today = todayManila();
  const monthStart = startOfMonthManila();
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { label: 'Today', from: today, to: today },
    { label: 'This week', from: mondayOf(today), to: today },
    { label: 'This month', from: monthStart, to: today },
    { label: 'Last month', from: lastMonthEnd.slice(0, 8) + '01', to: lastMonthEnd },
    { label: 'This year', from: today.slice(0, 4) + '-01-01', to: today },
  ];
}

export default async function ReportPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const user = await requireUser(ANY_REPORT);
  const { report } = await params;
  if (!isReportKey(report)) notFound();
  if (!canSeeReport(user, report)) redirect('/reports');
  const meta = REPORTS[report];
  const p = normalizeParams(await searchParams);
  const data = await buildReport(report, p, user.isAdmin);

  const qs = (extra: Record<string, string>) => {
    const u = new URLSearchParams({ from: p.from, to: p.to, ...(report === 'sales' ? { group: p.group ?? 'daily' } : {}), ...extra });
    return u.toString();
  };
  const tables = [data, ...(data.extra ?? [])];

  return (
    <div className="space-y-4">
      <style>{`
        @page { size: 8.5in 5.5in; margin: 8mm; }
        @media print {
          main { margin-left: 0 !important; padding: 0 !important; }
          .card { box-shadow: none !important; border: none !important; }
          .table { font-size: 8.5px; }
          .table th, .table td { padding: 2px 4px; }
          a { color: inherit !important; text-decoration: none !important; }
        }
      `}</style>

      <div className="no-print text-sm"><Link href="/reports" className="link">← All reports</Link></div>

      <PageHeader
        title={data.title}
        subtitle={data.period}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <a href={`/api/export/${report}?${qs({ format: 'csv' })}`} className="btn-secondary">Export CSV</a>
            <a href={`/api/export/${report}?${qs({ format: 'xlsx' })}`} className="btn-secondary">Export Excel</a>
            <PrintButton />
          </div>
        }
      />

      {'singleDay' in meta && meta.singleDay && (
        <div className="no-print card p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {[['Today', todayManila()], ['Yesterday', addDays(todayManila(), -1)]].map(([label, d]) => (
              <Link key={label} href={`/reports/${report}?${qs({ from: d, to: d })}`} className={`btn-sm ${p.to === d ? 'btn-primary' : 'btn-secondary'}`}>{label}</Link>
            ))}
          </div>
          <FilterBar>
            <label><span className="label">Day</span><input type="date" name="to" defaultValue={p.to} className="input w-auto" /></label>
          </FilterBar>
        </div>
      )}

      {meta.usesRange && (
        <div className="no-print card p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {presets().map((pr) => {
              const active = pr.from === p.from && pr.to === p.to;
              return (
                <Link key={pr.label} href={`/reports/${report}?${qs({ from: pr.from, to: pr.to })}`}
                  className={`btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}>
                  {pr.label}
                </Link>
              );
            })}
          </div>
          <FilterBar>
            <label><span className="label">From</span><input type="date" name="from" defaultValue={p.from} className="input w-auto" /></label>
            <label><span className="label">To</span><input type="date" name="to" defaultValue={p.to} className="input w-auto" /></label>
            {report === 'sales' && (
              <label>
                <span className="label">Group by</span>
                <select name="group" defaultValue={p.group} className="input w-auto">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
            )}
          </FilterBar>
        </div>
      )}

      {tables.map((t, i) => (
        <Card key={i} title={i === 0 ? undefined : t.title}>
          <ReportTable table={t} />
        </Card>
      ))}

      {data.notes && data.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
          {data.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}

      <p className="hidden text-xs text-slate-400 print:block">Paper &amp; Pixels · printed {fmtDateTime(new Date())} by {user.name}</p>
    </div>
  );
}
