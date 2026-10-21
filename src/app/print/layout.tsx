import { requireUser } from '@/lib/auth';
import { BackButton, PrintButton } from '@/components/PrintButton';

/** Bare layout for printable documents (no sidebar). Each page sets its own @page size. */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-between gap-2 px-2">
        <BackButton />
        <PrintButton />
      </div>
      {children}
    </div>
  );
}
