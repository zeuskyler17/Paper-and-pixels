import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { PAYSLIP_INCLUDE, PAYSLIP_PAGE_CSS, PayslipDoc } from '../PayslipDoc';

export const metadata = { title: 'Payslip' };

export default async function PrintPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('hr');
  const { id } = await params;
  const [p, s] = await Promise.all([
    prisma.payslip.findUnique({ where: { id: Number(id) || 0 }, include: PAYSLIP_INCLUDE }),
    getSettings(),
  ]);
  if (!p) notFound();
  return (
    <>
      <style>{PAYSLIP_PAGE_CSS}</style>
      <PayslipDoc p={p} s={s} />
    </>
  );
}
