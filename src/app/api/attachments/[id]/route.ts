import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUser, can } from '@/lib/auth';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  const { id } = await params;
  const file = await prisma.attachment.findUnique({
    where: { id: Number(id) || 0 },
    include: { job: true, expense: { select: { id: true } }, timeInEntry: { select: { id: true } }, timeOutEntry: { select: { id: true } } },
  });
  if (!file) return new NextResponse('Not found', { status: 404 });
  // Access depends on what the file belongs to:
  //  - time-clock selfies: HR permission
  //  - expense receipts: Expenses permission
  //  - job photos: production board managers, or the worker the job is assigned to
  const allowed = file.timeInEntry || file.timeOutEntry
    ? can(user, 'hr')
    : file.expense
      ? can(user, ['expenses', 'expenses_manage', 'reports'])
      : file.job
        ? can(user, 'jobs_manage') || (can(user, 'jobs_own') && file.job.assignedToId === user.id)
        : true;
  if (!allowed) return new NextResponse('Forbidden', { status: 403 });
  return new NextResponse(file.data, {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(file.filename)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
