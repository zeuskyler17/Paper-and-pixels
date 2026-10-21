import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { PAYSLIP_INCLUDE, PAYSLIP_PAGE_CSS, PayslipDoc } from '../../../payslip/PayslipDoc';

export const metadata = { title: 'Payslips' };

export default async function PrintRunPayslipsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('hr');
  const { id } = await params;
  const runId = Number(id) || 0;
  const [run, payslips, s] = await Promise.all([
    prisma.payrollRun.findUnique({ where: { id: runId }, select: { id: true } }),
    prisma.payslip.findMany({
      where: { runId },
      include: PAYSLIP_INCLUDE,
      orderBy: [{ employee: { lastName: 'asc' } }, { employee: { firstName: 'asc' } }],
    }),
    getSettings(),
  ]);
  if (!run) notFound();
  return (
    <>
      <style>{PAYSLIP_PAGE_CSS}</style>
      {payslips.length === 0 ? (
        <div className="mx-auto max-w-[148mm] bg-white p-8 text-center text-sm shadow">No payslips in this payroll run.</div>
      ) : (
        payslips.map((p) => <PayslipDoc key={p.id} p={p} s={s} />)
      )}
    </>
  );
}
