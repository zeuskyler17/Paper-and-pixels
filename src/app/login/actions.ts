'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { prisma, withBranch } from '@/lib/db';
import { isBranchKey } from '@/lib/branches';
import { createSession, destroySession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import type { ActionState } from '@/lib/action';

export async function login(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const branch = String(fd.get('branch') ?? '');
  if (!isBranchKey(branch)) return { error: 'Choose a branch.' };
  const username = String(fd.get('username') ?? '').trim().toLowerCase();
  const password = String(fd.get('password') ?? '');
  const res = await withBranch(branch, async () => {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) return { error: 'Wrong username or password for this branch.' };
    await createSession(user, branch);
    await audit(prisma, user.id, 'LOGIN', 'User', user.id, `${user.username} logged in`);
    return null;
  });
  if (res) return res;
  redirect('/'); // home page depends on the role's permissions
}

export async function logout() {
  await destroySession();
  redirect('/login');
}
