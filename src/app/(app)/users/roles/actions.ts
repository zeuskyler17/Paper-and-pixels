'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { createRoleTx, readRoleInput as read } from '@/lib/roles';

export async function createRole(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await attempt(async () => {
    const admin = await assertUser('admin');
    const data = read(fd);
    const r = await prisma.$transaction((tx) => createRoleTx(tx, admin.id, data));
    id = r.id;
  });
  if (res?.error) return res;
  redirect(`/users/roles/${id}`);
}

export async function updateRole(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await assertUser('admin');
    const data = read(fd);
    await prisma.$transaction(async (tx) => {
      const before = await tx.accessRole.findUniqueOrThrow({ where: { id } });
      if (before.isAdmin) throw new Error('The Admin (owner) role is locked and always has full access.');
      const clash = await tx.accessRole.findUnique({ where: { name: data.name } });
      if (clash && clash.id !== id) throw new Error(`A role named "${data.name}" already exists.`);
      await tx.accessRole.update({ where: { id }, data });
      const added = data.permissions.filter((p) => !before.permissions.includes(p));
      const removed = before.permissions.filter((p) => !(data.permissions as string[]).includes(p));
      await audit(tx, admin.id, 'UPDATE', 'AccessRole', id,
        `Updated role ${data.name}${added.length ? ` · added ${added.join(', ')}` : ''}${removed.length ? ` · removed ${removed.join(', ')}` : ''}`,
        { before: { name: before.name, description: before.description, permissions: before.permissions }, after: data });
    });
    revalidatePath('/users/roles');
    revalidatePath(`/users/roles/${id}`);
    return { ok: 'Role saved. Users with this role get the new access right away.' };
  });
}

export async function deleteRole(id: number, _prev: ActionState): Promise<ActionState> {
  const res = await attempt(async () => {
    const admin = await assertUser('admin');
    await prisma.$transaction(async (tx) => {
      const r = await tx.accessRole.findUniqueOrThrow({ where: { id }, include: { _count: { select: { users: true } } } });
      if (r.isAdmin) throw new Error('The Admin (owner) role cannot be deleted.');
      if (r._count.users > 0) throw new Error(`${r._count.users} user(s) still have this role. Give them another role first.`);
      await tx.accessRole.delete({ where: { id } });
      await audit(tx, admin.id, 'DELETE', 'AccessRole', id, `Deleted role ${r.name}`, { permissions: r.permissions });
    });
  });
  if (res?.error) return res;
  redirect('/users/roles');
}
