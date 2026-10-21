'use server';

import { ASSIGNABLE_WORKER } from '@/lib/permissions';
import { revalidatePath } from 'next/cache';
import type { JobStatus } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { assertUser, can, type SessionUser } from '@/lib/auth';
import { attempt, optInt, optStr, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { changeJobStatus } from '@/lib/jobs';
import { getSettings } from '@/lib/settings';
import { saveUpload } from '@/lib/uploads';
import { JOB_STATUS } from '@/lib/labels';

const JOB_ACCESS = ['jobs_manage', 'jobs_own'] as const; // board managers and production workers
const MOVABLE: JobStatus[] = ['PENDING', 'IN_PROCESS', 'QUALITY_CHECK', 'COMPLETED'];

type Result = { error?: string; ok?: string };

function refresh(jobId: number) {
  revalidatePath('/jobs');
  revalidatePath(`/jobs/${jobId}`);
}

/** Loads the job and checks that a worker only touches jobs assigned to them. */
async function loadJob(tx: Tx, jobId: number, user: SessionUser) {
  const job = await tx.job.findUnique({ where: { id: jobId }, include: { order: { select: { orderNo: true } } } });
  if (!job) throw new Error('Job not found.');
  if (!can(user, 'jobs_manage') && job.assignedToId !== user.id) throw new Error('This job is not assigned to you.');
  return job;
}

async function runStatusChange(jobId: number, to: string, note: string | null) {
  const user = await assertUser([...JOB_ACCESS]);
  if (!(to in JOB_STATUS)) throw new Error('Invalid status.');
  if (to === 'CANCELLED') throw new Error('Use "Cancel job" with a reason to cancel a job.');
  const settings = await getSettings();
  await prisma.$transaction(async (tx) => {
    await loadJob(tx, jobId, user);
    await changeJobStatus(tx, jobId, to as JobStatus, user, settings.bom_deduct_on, note);
  });
  refresh(jobId);
  return `Moved to ${JOB_STATUS[to]}.`;
}

/** Called directly from the board (drag-and-drop, buttons, select). */
export async function moveJob(jobId: number, to: string): Promise<Result> {
  const res = await attempt(async () => {
    if (!MOVABLE.includes(to as JobStatus)) throw new Error('Invalid status.');
    return { ok: await runStatusChange(jobId, to, null) };
  });
  return res ?? {};
}

/**
 * A production worker takes an unassigned, pending job for themselves. Recorded like any assignment
 * ("Assigned by" = the worker). Board managers assign the normal way instead.
 */
async function runTake(jobId: number) {
  const user = await assertUser('jobs_own');
  await prisma.$transaction(async (tx) => {
    const me = await tx.user.findFirst({ where: { id: user.id, ...ASSIGNABLE_WORKER } });
    if (!me) throw new Error('Only production workers can take jobs.');
    const job = await tx.job.findUnique({ where: { id: jobId }, include: { order: { select: { orderNo: true, status: true } }, assignedTo: { select: { name: true } } } });
    if (!job) throw new Error('Job not found.');
    if (job.order.status === 'CANCELLED' || job.status === 'CANCELLED') throw new Error('This job was cancelled.');
    if (job.assignedToId === user.id) return;
    if (job.assignedToId) throw new Error(`This job is already with ${job.assignedTo?.name ?? 'another worker'}.`);
    if (job.status !== 'PENDING') throw new Error('Only pending jobs can be taken.');
    await tx.job.update({ where: { id: jobId }, data: { assignedToId: user.id, assignedById: user.id, assignedAt: new Date() } });
    await tx.jobStatusLog.create({ data: { jobId, note: `Took the job (self-assigned)`, userId: user.id } });
    await audit(tx, user.id, 'UPDATE', 'Job', jobId, `${job.order.orderNo}: ${user.name} took the job`, { from: null, to: user.id, self: true });
  });
  refresh(jobId);
}

/** "Take this job" on the board. */
export async function takeJob(jobId: number): Promise<Result> {
  const res = await attempt(async () => { await runTake(jobId); return { ok: 'The job is now yours. Press Start when you begin.' }; });
  return res ?? {};
}

/** "Take this job" on the job page. */
export async function takeJobForm(jobId: number, _prev: ActionState): Promise<ActionState> {
  return attempt(async () => { await runTake(jobId); return { ok: 'The job is now yours. Press Start when you begin.' }; });
}

/** Status buttons on the job page (submit button named "to", optional note). */
export async function setJobStatus(jobId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => ({ ok: await runStatusChange(jobId, str(fd, 'to'), optStr(fd, 'note')) }));
}

async function runAssign(jobId: number, workerId: number | null) {
  const user = await assertUser('jobs_manage');
  await prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, jobId, user);
    if (job.status === 'CANCELLED' || job.status === 'COMPLETED') throw new Error(`This job is already ${JOB_STATUS[job.status].toLowerCase()}.`);
    if (job.assignedToId === workerId) return;
    let workerName = 'nobody';
    if (workerId !== null) {
      const worker = await tx.user.findFirst({ where: { id: workerId, ...ASSIGNABLE_WORKER } });
      if (!worker) throw new Error('Choose an active production worker.');
      workerName = worker.name;
    } else if (job.status !== 'PENDING') {
      throw new Error('A job in progress must stay assigned to a worker.');
    }
    await tx.job.update({ where: { id: jobId }, data: { assignedToId: workerId, assignedById: workerId === null ? null : user.id, assignedAt: workerId === null ? null : new Date() } });
    const note = workerId === null ? 'Unassigned' : `Assigned to ${workerName}`;
    await tx.jobStatusLog.create({ data: { jobId, note, userId: user.id } });
    await audit(tx, user.id, 'UPDATE', 'Job', jobId, `${job.order.orderNo}: ${note}`, { from: job.assignedToId, to: workerId });
  });
  refresh(jobId);
}

/** Called directly from the board's worker dropdown. */
export async function assignWorker(jobId: number, workerId: number | null): Promise<Result> {
  const res = await attempt(async () => {
    await runAssign(jobId, workerId);
    return { ok: 'Worker assigned.' };
  });
  return res ?? {};
}

export async function assignWorkerForm(jobId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    await runAssign(jobId, optInt(fd, 'workerId'));
    return { ok: 'Worker assignment saved.' };
  });
}

/** Progress note and/or photo. */
export async function addProgress(jobId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser([...JOB_ACCESS]);
    const note = optStr(fd, 'note');
    const photo = fd.get('photo');
    const hasPhoto = photo && typeof photo !== 'string' && photo.size > 0;
    if (!note && !hasPhoto) throw new Error('Write a note or choose a photo.');
    await prisma.$transaction(async (tx) => {
      const job = await loadJob(tx, jobId, user);
      const file = await saveUpload(tx, photo, user.id, jobId);
      const logNote = [note, file ? `Photo uploaded: ${file.filename}` : null].filter(Boolean).join(' — ');
      await tx.jobStatusLog.create({ data: { jobId, note: logNote, userId: user.id } });
      await audit(tx, user.id, 'NOTE', 'Job', jobId, `${job.order.orderNo}: ${logNote}`, file ? { attachmentId: file.id } : undefined);
    });
    refresh(jobId);
    return { ok: hasPhoto ? 'Progress update and photo saved.' : 'Note added.' };
  });
}

export async function cancelJob(jobId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await assertUser('jobs_manage');
    const reason = str(fd, 'reason');
    if (!reason) throw new Error('Enter a reason for cancelling this job.');
    const settings = await getSettings();
    await prisma.$transaction(async (tx) => {
      await changeJobStatus(tx, jobId, 'CANCELLED', user, settings.bom_deduct_on, `Cancelled: ${reason}`);
    });
    refresh(jobId);
    return { ok: 'Job cancelled.' };
  });
}
