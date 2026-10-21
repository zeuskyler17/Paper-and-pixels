import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { ANY_REPORT, canSeeReport, REPORTS, type ReportKey } from './_data';

export const metadata = { title: 'Reports' };

export default async function ReportsPage() {
  const user = await requireUser(ANY_REPORT);
  const keys = (Object.keys(REPORTS) as ReportKey[]).filter((k) => canSeeReport(user, k));
  return (
    <div>
      <PageHeader title="Reports" subtitle="Every report can be filtered by date, printed, and exported to CSV or Excel." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {keys.map((k) => (
          <Link key={k} href={`/reports/${k}`} className="card block p-4 transition hover:border-brand-500 hover:shadow">
            <div className="font-semibold text-slate-900">{REPORTS[k].title}</div>
            <div className="mt-1 text-sm text-slate-500">{REPORTS[k].description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
