import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Card, PageHeader } from '@/components/ui';
import { periodPresets } from '../_lib';
import { NewRunForm } from './NewRunForm';

export const metadata = { title: 'New payroll run' };

export default async function NewPayrollRunPage() {
  await requireUser('hr');
  const counts = await prisma.employee.groupBy({
    by: ['payFrequency'],
    where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
    _count: true,
  });
  const n = (f: string) => counts.find((c) => c.payFrequency === f)?._count ?? 0;
  const defaultFrequency = n('WEEKLY') > n('SEMI_MONTHLY') ? 'WEEKLY' : 'SEMI_MONTHLY';

  return (
    <div className="space-y-4">
      <PageHeader
        title="New payroll run"
        subtitle={`${n('SEMI_MONTHLY')} active semi-monthly · ${n('WEEKLY')} active weekly employee(s)`}
        actions={<Link href="/payroll" className="btn-secondary">← Payroll</Link>}
      />
      <Card title="Pay period" className="max-w-3xl">
        <NewRunForm presets={periodPresets()} defaultFrequency={defaultFrequency} />
      </Card>
    </div>
  );
}
