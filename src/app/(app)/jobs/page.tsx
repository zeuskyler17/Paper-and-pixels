import Link from 'next/link';
import { ASSIGNABLE_WORKER } from '@/lib/permissions';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser, can } from '@/lib/auth';
import { daysBetween, fmtDate, isOverdue, manilaDayRange, todayManila, addDays, fmtDateTime } from '@/lib/dates';
import { Card, FilterBar, PageHeader } from '@/components/ui';
import { Board, type JobCard } from './Board';
import { groupSpecs } from '@/lib/pricing';

export const metadata = { title: 'Production board' };

type SP = Promise<{ q?: string; worker?: string; category?: string; due?: string; cancelled?: string; alldone?: string }>;

const COMPLETED_DAYS = 14;

export default async function JobsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser(['jobs_manage', 'jobs_own']);
  const isWorker = !can(user, 'jobs_manage'); // own jobs only
  const { q = '', worker = '', category = '', due = '', cancelled, alldone } = await searchParams;

  const and: Prisma.JobWhereInput[] = [];
  // Workers see their own jobs, plus unassigned pending jobs they can take — enforced in the query.
  if (isWorker) and.push({ OR: [{ assignedToId: user.id }, { assignedToId: null, status: 'PENDING' }] });
  else if (worker === 'none') and.push({ assignedToId: null });
  else if (worker) and.push({ assignedToId: Number(worker) });

  if (category) and.push({ orderItem: { product: { categoryId: Number(category) } } });
  if (q) {
    and.push({
      order: { OR: [{ orderNo: { contains: q, mode: 'insensitive' } }, { customer: { name: { contains: q, mode: 'insensitive' } } }] },
    });
  }

  const today = manilaDayRange();
  if (due === 'overdue') and.push({ dueDate: { lt: today.start }, status: { notIn: ['COMPLETED', 'CANCELLED'] } });
  if (due === 'today') and.push({ dueDate: { gte: today.start, lt: today.end } });
  if (due === 'week') and.push({ dueDate: { gte: today.start, lt: manilaDayRange(addDays(todayManila(), 6)).end } });

  const doneCutoff = new Date(Date.now() - COMPLETED_DAYS * 86_400_000);
  const statusOr: Prisma.JobWhereInput[] = [
    { status: { in: ['PENDING', 'IN_PROCESS', 'QUALITY_CHECK'] } },
    // Completed jobs stay on the board until their order is released / delivered (all completed: everything).
    alldone ? { status: 'COMPLETED' } : { status: 'COMPLETED', completedAt: { gte: doneCutoff }, order: { status: { not: 'DELIVERED' } } },
  ];
  if (cancelled) statusOr.push({ status: 'CANCELLED' });
  and.push({ OR: statusOr });

  const perCategory = prisma.job.groupBy({
    by: ['orderItemId'],
    where: { AND: and.filter((w) => !('orderItem' in w)), status: { in: ['PENDING', 'IN_PROCESS', 'QUALITY_CHECK'] } },
  });
  const [jobs, workers, categories, openJobs] = await Promise.all([
    prisma.job.findMany({
      where: { AND: and },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: 600,
      include: {
        order: { select: { id: true, orderNo: true, status: true, balance: true, customer: { select: { name: true } }, jobs: { select: { status: true } } } },
        assignedTo: { select: { id: true, name: true } },
        assignedBy: { select: { name: true } },
        // latest status move (who moved it where); assignment-only log rows have no toStatus
        logs: { where: { toStatus: { not: null } }, orderBy: { createdAt: 'desc' }, take: 1, select: { toStatus: true, createdAt: true, user: { select: { name: true } } } },
        orderItem: {
          select: {
            description: true, quantity: true, widthFt: true, heightFt: true, specsNotes: true,
            specs: { select: { name: true, value: true }, orderBy: { id: 'asc' } },
            product: { select: { category: { select: { name: true } } } },
          },
        },
      },
    }),
    isWorker ? [] : prisma.user.findMany({ where: ASSIGNABLE_WORKER, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.productCategory.findMany({ where: { requiresProduction: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    perCategory.then((rows) => prisma.orderItem.findMany({ where: { id: { in: rows.map((r) => r.orderItemId) } }, select: { product: { select: { categoryId: true } } } })),
  ]);
  const openByCategory = new Map<number, number>();
  for (const it of openJobs) openByCategory.set(it.product.categoryId, (openByCategory.get(it.product.categoryId) ?? 0) + 1);
  const current = categories.find((c) => c.id === Number(category)) ?? null;
  const tabHref = (cat: string) => { const p = new URLSearchParams(); if (cat) p.set('category', cat); if (q) p.set('q', q); if (worker) p.set('worker', worker); if (due) p.set('due', due); if (alldone) p.set('alldone', '1'); if (cancelled) p.set('cancelled', '1'); const s = p.toString(); return s ? `/jobs?${s}` : '/jobs'; };

  const cards: JobCard[] = jobs.map((j) => {
    const it = j.orderItem;
    const size = it.widthFt && it.heightFt ? `${it.widthFt} × ${it.heightFt} ft` : null;
    return {
      id: j.id,
      status: j.status,
      orderId: j.order.id,
      orderNo: j.order.orderNo,
      customer: j.order.customer.name,
      product: it.description,
      category: it.product.category.name,
      quantity: it.quantity,
      size,
      specs: groupSpecs(it.specs).map(([n, v]) => `${n}: ${v}`),
      specsNotes: it.specsNotes,
      due: j.dueDate ? fmtDate(j.dueDate) : null,
      overdue: isOverdue(j.dueDate) && j.status !== 'COMPLETED' && j.status !== 'CANCELLED',
      elapsedDays: daysBetween(j.createdAt),
      assignedToId: j.assignedToId,
      assignedName: j.assignedTo?.name ?? null,
      assignedBy: j.assignedBy && j.assignedAt ? `${j.assignedBy.name} · ${fmtDateTime(j.assignedAt)}` : null,
      lastMove: j.logs[0] ? { to: j.logs[0].toStatus!, by: j.logs[0].user.name, at: fmtDateTime(j.logs[0].createdAt) } : null,
      release: j.status === 'COMPLETED' && j.order.status !== 'DELIVERED' && j.order.status !== 'CANCELLED'
        ? { balance: j.order.balance, ready: j.order.jobs.every((x) => x.status === 'COMPLETED' || x.status === 'CANCELLED') }
        : null,
    };
  });

  const active = cards.filter((c) => c.status !== 'COMPLETED' && c.status !== 'CANCELLED').length;
  const overdue = cards.filter((c) => c.overdue).length;

  return (
    <div>
      <PageHeader
        title={current ? `${current.name} board${isWorker ? ' — my jobs' : ''}` : isWorker ? 'My jobs' : 'Production board'}
        subtitle={`${active} active job${active === 1 ? '' : 's'}${overdue ? ` · ${overdue} overdue` : ''}${isWorker && cards.some((c) => c.assignedToId === null) ? ` · ${cards.filter((c) => c.assignedToId === null).length} unassigned — press “Take this job” to claim one` : ''} · completed column shows ${alldone ? 'all' : `the last ${COMPLETED_DAYS} days`}`}
      />
      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200 pb-3">
        {[{ id: 0, name: 'All boards' }, ...categories].map((c) => {
          const on = c.id === 0 ? !current : current?.id === c.id;
          const n = c.id === 0 ? openJobs.length : openByCategory.get(c.id) ?? 0;
          return (
            <Link key={c.id} href={tabHref(c.id ? String(c.id) : '')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${on ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {c.name}
              <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${on ? 'bg-white/20' : 'bg-slate-200 text-slate-700'}`}>{n}</span>
            </Link>
          );
        })}
      </div>
      <Card className="mb-4">
        <FilterBar>
          {category && <input type="hidden" name="category" value={category} />}
          <input name="q" defaultValue={q} placeholder="Order no. or customer" className="input w-56" />
          {!isWorker && (
            <select name="worker" defaultValue={worker} className="input w-auto">
              <option value="">All workers</option>
              <option value="none">Unassigned</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <select name="due" defaultValue={due} className="input w-auto">
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">Due this week</option>
          </select>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="alldone" value="1" defaultChecked={!!alldone} /> All completed</label>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="cancelled" value="1" defaultChecked={!!cancelled} /> Show cancelled</label>
        </FilterBar>
      </Card>
      <Board jobs={cards} workers={workers} canAssign={!isWorker} canRelease={can(user, 'orders')} showCancelled={!!cancelled} />
    </div>
  );
}
