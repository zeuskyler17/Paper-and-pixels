import type { JobStatus } from '@prisma/client';
import type { Tx } from './db';
import type { SessionUser } from './auth';
import { can } from './permissions';
import { deductBomForJob, returnJobMaterials } from './inventory';
import { syncOrderStatusFromJobs } from './orders';
import { audit } from './audit';
import { JOB_STATUS } from './labels';

/**
 * The one place a job changes status. Enforces:
 *  - a job cannot go In Process (or beyond) without an assigned worker
 *  - workers may only move jobs assigned to them
 *  - materials (BOM) are auto-deducted once when the job reaches `deductOn`
 *  - the parent order's status follows its jobs
 */
export async function changeJobStatus(
  tx: Tx,
  jobId: number,
  to: JobStatus,
  user: SessionUser,
  deductOn: string,
  note?: string | null,
) {
  const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, include: { order: true } });
  if (job.status === to) return job;
  if (!can(user, 'jobs_manage') && job.assignedToId !== user.id) throw new Error('This job is not assigned to you.');
  if (!can(user, 'jobs_manage') && to === 'CANCELLED') throw new Error('Only users who manage the production board can cancel a job.');
  if (job.order.status === 'CANCELLED') throw new Error('The order for this job was cancelled.');
  if (to !== 'PENDING' && to !== 'CANCELLED' && !job.assignedToId) {
    throw new Error('Assign a worker before starting this job.');
  }

  const now = new Date();
  const updated = await tx.job.update({
    where: { id: jobId },
    data: {
      status: to,
      startedAt: to === 'IN_PROCESS' && !job.startedAt ? now : undefined,
      completedAt: to === 'COMPLETED' ? now : to === 'PENDING' || to === 'IN_PROCESS' ? null : undefined,
    },
  });
  await tx.jobStatusLog.create({ data: { jobId, fromStatus: job.status, toStatus: to, note: note || null, userId: user.id } });

  const order: JobStatus[] = ['PENDING', 'IN_PROCESS', 'QUALITY_CHECK', 'COMPLETED'];
  const reached = (s: JobStatus) => order.indexOf(to) >= order.indexOf(s) && to !== 'CANCELLED';
  if (reached(deductOn === 'COMPLETED' ? 'COMPLETED' : 'IN_PROCESS')) await deductBomForJob(tx, jobId, user.id);
  // Cancelled after materials were deducted: put them back in stock.
  if (to === 'CANCELLED' && job.materialsDeducted) await returnJobMaterials(tx, jobId, user.id, `${job.order.orderNo} job cancelled${note ? ` (${note})` : ''}`);

  await syncOrderStatusFromJobs(tx, job.orderId);
  await audit(tx, user.id, 'STATUS', 'Job', jobId, `${job.order.orderNo}: ${JOB_STATUS[job.status]} → ${JOB_STATUS[to]}`);
  return updated;
}
