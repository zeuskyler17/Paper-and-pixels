import Link from 'next/link';
import type { EmploymentStatus, PayType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { peso } from '@/lib/money';
import { employeeName } from '@/lib/hr';
import { EMPLOYMENT_STATUS, PAY_FREQUENCY, PAY_TYPE } from '@/lib/labels';
import { Card, Empty, FilterBar, PageHeader, Stat, StatusBadge, TableWrap } from '@/components/ui';
import { monthlyEstimate, rateLabel, scheduleLabel } from './_lib';
import { PeopleTabs } from '../users/_tabs';

export const metadata = { title: 'Employees' };

type SP = Promise<{ q?: string; status?: string; pay?: string }>;

const FREQ_SHORT: Record<string, string> = { WEEKLY: 'Weekly', SEMI_MONTHLY: 'Semi-monthly' };

export default async function EmployeesPage({ searchParams }: { searchParams: SP }) {
  const me = await requireUser('hr');
  const { q = '', status = 'current', pay = '' } = await searchParams;

  const where: Prisma.EmployeeWhereInput = {};
  if (status === 'current') where.status = { in: ['ACTIVE', 'ON_LEAVE'] };
  else if (status in EMPLOYMENT_STATUS) where.status = status as EmploymentStatus;
  if (pay in PAY_TYPE) where.payType = pay as PayType;
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { nickname: { contains: q, mode: 'insensitive' } },
      { employeeNo: { contains: q, mode: 'insensitive' } },
      { position: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [employees, current, openAdvances] = await Promise.all([
    prisma.employee.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true, employeeNo: true, firstName: true, lastName: true, nickname: true, position: true, payType: true, rate: true,
        payFrequency: true, shiftStart: true, shiftEnd: true, workDays: true, status: true, pinHash: true,
        user: { select: { username: true, active: true, accessRole: { select: { name: true } } } },
      },
    }),
    prisma.employee.findMany({ where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } }, select: { status: true, payType: true, rate: true, workDays: true } }),
    prisma.cashAdvance.aggregate({ where: { status: 'OPEN' }, _sum: { balance: true }, _count: true }),
  ]);

  const activeCount = current.filter((e) => e.status === 'ACTIVE').length;
  const onLeave = current.filter((e) => e.status === 'ON_LEAVE').length;
  const payroll = current.reduce((s, e) => s + monthlyEstimate(e), 0);

  return (
    <div>
      <PageHeader
        title="Employees & Users"
        subtitle={`${employees.length} shown`}
        actions={me.isAdmin ? <Link href="/employees/new" className="btn-primary">+ New employee</Link> : undefined}
      />
      <PeopleTabs active="employees" user={me} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active employees" value={activeCount} tone="green" />
        <Stat label="On leave" value={onLeave} tone={onLeave ? 'amber' : undefined} />
        <Stat label="Monthly payroll (est.)" value={peso(payroll)} hint="Monthly salaries + daily rates × avg. work days" />
        <Stat label="Open cash advances" value={peso(openAdvances._sum.balance ?? 0)} hint={`${openAdvances._count} open`} tone={(openAdvances._sum.balance ?? 0) > 0 ? 'amber' : undefined} />
      </div>
      <Card>
        <FilterBar>
          <input name="q" defaultValue={q} placeholder="Search name, employee no., position" className="input w-full sm:w-72" />
          <select name="status" defaultValue={status} className="input w-auto">
            <option value="current">Active + On leave</option>
            {Object.entries(EMPLOYMENT_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <option value="all">All statuses</option>
          </select>
          <select name="pay" defaultValue={pay} className="input w-auto">
            <option value="">All pay types</option>
            {Object.entries(PAY_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </FilterBar>
        {employees.length === 0 ? <Empty>No employees found.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>No.</th><th>Name</th><th>Position</th><th className="text-right">Rate</th><th>Frequency</th>
                  <th>Schedule</th><th>Login / role</th><th>PIN</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="num whitespace-nowrap text-slate-500">{e.employeeNo}</td>
                    <td className="whitespace-nowrap">
                      <Link href={`/employees/${e.id}`} className="link">{employeeName(e)}</Link>
                      {e.nickname && <span className="ml-1 text-slate-500">“{e.nickname}”</span>}
                    </td>
                    <td>{e.position}</td>
                    <td className="whitespace-nowrap text-right">{rateLabel(e)}</td>
                    <td className="whitespace-nowrap" title={PAY_FREQUENCY[e.payFrequency]}>{FREQ_SHORT[e.payFrequency] ?? e.payFrequency}</td>
                    <td className="num whitespace-nowrap text-[12.5px]">{scheduleLabel(e)}</td>
                    <td>{e.user ? <><span className="num">{e.user.username}</span><div className="text-[11px] text-slate-500">{e.user.accessRole?.name ?? 'No role'}{e.user.active ? '' : ' · inactive'}</div></> : <span className="text-xs text-slate-400">no login</span>}</td>
                    <td>{e.pinHash ? 'Yes' : <span className="text-slate-400">No</span>}</td>
                    <td><StatusBadge value={e.status} labels={EMPLOYMENT_STATUS} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
