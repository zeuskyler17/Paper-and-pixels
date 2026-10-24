import { ASSIGNABLE_WORKER } from '@/lib/permissions';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser, can } from '@/lib/auth';
import { daysBetween, fmtDate, fmtDateTime, isOverdue } from '@/lib/dates';
import { FILE_SOURCE, JOB_COLUMNS, JOB_STATUS } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { ImageUpload } from '@/components/ImageUpload';
import { Card, DL, Empty, PageHeader, StatusBadge } from '@/components/ui';
import { addProgress, assignWorkerForm, cancelJob, setJobStatus, takeJobForm } from '../actions';
import { groupSpecs } from '@/lib/pricing';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(['jobs_manage', 'jobs_own']);
  const isStaff = can(user, 'jobs_manage'); // otherwise: own jobs only
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) notFound();

  const job = await prisma.job.findFirst({
    // Workers can open their own jobs, and unassigned pending ones they may take.
    where: { id: jobId, ...(isStaff ? {} : { OR: [{ assignedToId: user.id }, { assignedToId: null, status: 'PENDING' }] }) },
    include: {
      order: { select: { id: true, orderNo: true, targetDate: true, customer: { select: { name: true, mobile: true } } } },
      assignedTo: { select: { id: true, name: true } },
      assignedBy: { select: { name: true } },
      orderItem: {
        select: {
          description: true, quantity: true, widthFt: true, heightFt: true, specsNotes: true, fileSource: true, fileSourceNote: true,
          specs: { select: { id: true, name: true, value: true }, orderBy: { id: 'asc' } },
          product: { select: { category: { select: { name: true } } } },
        },
      },
      logs: { orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true } } } },
      attachments: { orderBy: { createdAt: 'desc' }, select: { id: true, filename: true, mimeType: true, createdAt: true, createdBy: { select: { name: true } } } },
    },
  });
  if (!job) notFound();

  const workers = isStaff
    ? await prisma.user.findMany({ where: ASSIGNABLE_WORKER, orderBy: { name: 'asc' }, select: { id: true, name: true } })
    : [];

  const it = job.orderItem;
  const overdue = isOverdue(job.dueDate) && job.status !== 'COMPLETED' && job.status !== 'CANCELLED';
  const closed = job.status === 'CANCELLED';
  const curIdx = (JOB_COLUMNS as readonly string[]).indexOf(job.status);
  const otherStatuses = JOB_COLUMNS.filter((s) => s !== job.status);
  const fileSource = it.fileSource === 'NONE' ? FILE_SOURCE.NONE : [FILE_SOURCE[it.fileSource], it.fileSourceNote].filter(Boolean).join(' — ');

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${job.order.orderNo} · ${it.description}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge value={job.status} labels={JOB_STATUS} />
            {overdue && <span className="font-semibold text-red-600">Overdue</span>}
            <span>{daysBetween(job.createdAt)} day(s) since created</span>
          </span>
        }
        actions={<Link href="/jobs" className="btn-secondary">← Board</Link>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Job details">
          <DL
            items={[
              ['Order no.', isStaff ? <Link href={`/orders/${job.order.id}`} className="link">{job.order.orderNo}</Link> : job.order.orderNo],
              ['Customer', job.order.customer.name],
              ['Mobile', job.order.customer.mobile],
              ['Product', `${it.description} (${it.product.category.name})`],
              ['Quantity', String(it.quantity)],
              ['Size', it.widthFt && it.heightFt ? `${it.widthFt} × ${it.heightFt} ft` : null],
              ['File source', fileSource],
              ['Due date', <span key="due" className={overdue ? 'text-red-600' : ''}>{fmtDate(job.dueDate)}</span>],
              ['Assigned worker', job.assignedTo?.name ?? 'Unassigned'],
              ['Assigned by', job.assignedBy && job.assignedAt ? `${job.assignedBy.name} · ${fmtDateTime(job.assignedAt)}` : null],
              ['Started by', (() => { const l = job.logs.find((x) => x.toStatus === 'IN_PROCESS'); return l ? `${l.user.name} · ${fmtDateTime(l.createdAt)}` : null; })()],
              ['Last moved by', (() => { const l = job.logs.find((x) => x.toStatus); return l ? `${l.user.name} → ${JOB_STATUS[l.toStatus!]} · ${fmtDateTime(l.createdAt)}` : null; })()],
              ['Started', fmtDateTime(job.startedAt)],
              ['Completed', fmtDateTime(job.completedAt)],
              ['Materials deducted', job.materialsDeducted ? 'Yes' : 'Not yet'],
            ]}
          />
        </Card>

        <Card title="Specifications">
          {it.specs.length === 0 && !it.specsNotes ? <Empty>No specifications recorded.</Empty> : (
            <div className="space-y-3">
              {it.specs.length > 0 && <DL items={groupSpecs(it.specs).map(([n, v]) => [n, v] as [string, React.ReactNode])} />}
              {it.specsNotes && (
                <div>
                  <div className="label">Notes</div>
                  <p className="whitespace-pre-wrap rounded-md bg-amber-50 p-3 text-sm">{it.specsNotes}</p>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Update status">
          {closed ? (
            isStaff ? (
              <ActionForm action={setJobStatus.bind(null, job.id)} className="space-y-3">
                <p className="text-sm text-slate-600">This job was cancelled. Reopen it to put it back on the board.</p>
                <input name="note" className="input" placeholder="Reason for reopening (optional)" />
                <button name="to" value="PENDING" className="btn-secondary">Reopen as Pending</button>
              </ActionForm>
            ) : <p className="text-sm text-slate-600">This job was cancelled.</p>
          ) : !isStaff && !job.assignedTo ? (
            <ActionForm action={takeJobForm.bind(null, job.id)} className="space-y-3">
              <p className="text-sm text-slate-600">This job is not assigned to anyone yet. Take it and it becomes yours; then you can start it.</p>
              <SubmitButton>✋ Take this job</SubmitButton>
            </ActionForm>
          ) : (
            <ActionForm action={setJobStatus.bind(null, job.id)} className="space-y-3">
              <textarea name="note" rows={2} className="input" placeholder="Note for this change (optional)" />
              <div className="flex flex-wrap gap-2">
                {otherStatuses.map((s) => (
                  <button key={s} name="to" value={s} className={JOB_COLUMNS.indexOf(s) > curIdx ? 'btn-primary' : 'btn-secondary'}>
                    {JOB_COLUMNS.indexOf(s) > curIdx ? '' : '◀ '}{JOB_STATUS[s]}
                  </button>
                ))}
              </div>
              {!job.assignedTo && <p className="text-xs text-amber-700">Assign a worker before starting this job.</p>}
            </ActionForm>
          )}
        </Card>

        {isStaff && !closed && job.status !== 'COMPLETED' && (
          <Card title="Assigned worker">
            <ActionForm action={assignWorkerForm.bind(null, job.id)} className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[12rem] flex-1">
                <span className="label">Worker</span>
                <select name="workerId" defaultValue={job.assignedToId ?? ''} className="input">
                  <option value="">— Unassigned —</option>
                  {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          </Card>
        )}

        <Card title="Progress update">
          <ActionForm action={addProgress.bind(null, job.id)} className="space-y-3" resetOnSuccess>
            <textarea name="note" rows={2} className="input" placeholder="e.g. Layout approved by customer, printing tomorrow" />
            <ImageUpload name="photo" label="Progress photo (optional)" />
            <SubmitButton>Add update</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card title={`Photos (${job.attachments.length})`}>
        {job.attachments.length === 0 ? <Empty>No photos uploaded yet.</Empty> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {job.attachments.map((a) => (
              <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border bg-slate-50 hover:opacity-90">
                {a.mimeType.startsWith('image/') ? (
                  <img src={`/api/attachments/${a.id}`} alt={a.filename} className="aspect-square w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex aspect-square items-center justify-center p-2 text-center text-xs text-slate-600">{a.filename}</div>
                )}
                <div className="px-2 py-1 text-[11px] text-slate-500">{fmtDateTime(a.createdAt)} · {a.createdBy.name}</div>
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card title="History">
        {job.logs.length === 0 ? <Empty>No history yet.</Empty> : (
          <ol className="space-y-3">
            {job.logs.map((l) => (
              <li key={l.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                <div className="text-xs text-slate-500">{fmtDateTime(l.createdAt)} · {l.user.name}</div>
                {l.toStatus && (
                  <div className="flex flex-wrap items-center gap-1">
                    {l.fromStatus && <><StatusBadge value={l.fromStatus} labels={JOB_STATUS} /> →</>}
                    <StatusBadge value={l.toStatus} labels={JOB_STATUS} />
                  </div>
                )}
                {l.note && <p className="mt-0.5 whitespace-pre-wrap">{l.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {isStaff && !closed && (
        <Card title="Cancel job">
          <ActionForm action={cancelJob.bind(null, job.id)} className="flex flex-wrap items-end gap-2" confirm="Cancel this job?">
            <label className="block min-w-[14rem] flex-1">
              <span className="label">Reason</span>
              <input name="reason" required className="input" placeholder="e.g. Customer changed the design" />
            </label>
            <SubmitButton className="btn-danger">Cancel job</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
