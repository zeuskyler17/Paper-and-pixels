'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma, type Tx } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, str, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';
import { createRoleTx, readRoleInput } from '@/lib/roles';
/** The chosen access role; the legacy enum `role` is kept in sync (ADMIN for the locked Admin role). */
async function readRole(tx: Tx, fd: FormData, adminId: number) {
  const raw = str(fd, 'accessRoleId');
  const id = Number(raw);
  // "+ New role" picked on the user form: create it from the typed name and ticked boxes.
  const r = raw === 'new' ? await createRoleTx(tx, adminId, readRoleInput(fd, 'role_'))
    : id ? await tx.accessRole.findUnique({ where: { id } }) : null;
  if (!r) throw new Error('Choose a role.');
  return { accessRoleId: r.id, isAdmin: r.isAdmin, roleName: r.name, role: (r.isAdmin ? 'ADMIN' : 'STAFF') as 'ADMIN' | 'STAFF' };
}

function readPassword(fd: FormData): string {
  const password = String(fd.get('password') ?? '');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  if (fd.has('confirm') && password !== String(fd.get('confirm') ?? '')) throw new Error('Passwords do not match.');
  return password;
}

/** Number of active admins other than `excludeId`. */
async function otherActiveAdmins(tx: Tx, excludeId: number) {
  return tx.user.count({ where: { accessRole: { isAdmin: true }, active: true, id: { not: excludeId } } });
}

export async function createUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const res = await attempt(async () => {
    const admin = await assertUser('admin');
    const name = str(fd, 'name');
    const username = str(fd, 'username').toLowerCase();
    if (!name) throw new Error('Name is required.');
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      throw new Error('Username must be 3–32 characters: lowercase letters, numbers, dot, dash or underscore.');
    }
    const passwordHash = await bcrypt.hash(readPassword(fd), 10);

    const u = await prisma.$transaction(async (tx) => {
      const r = await readRole(tx, fd, admin.id);
      if (await tx.user.findUnique({ where: { username } })) throw new Error(`Username "${username}" is already taken.`);
      const u = await tx.user.create({ data: { name, username, role: r.role, accessRoleId: r.accessRoleId, passwordHash } });
      await audit(tx, admin.id, 'CREATE', 'User', u.id, `Created user ${username} (${r.roleName})`, { name, username, role: r.roleName });
      return u;
    });
    id = u.id;
  });
  if (res?.error) return res;
  redirect(`/users/${id}`);
}

export async function updateUser(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await assertUser('admin');
    const name = str(fd, 'name');
    if (!name) throw new Error('Name is required.');
    const active = fd.get('active') === 'on' || fd.get('active') === '1';

    await prisma.$transaction(async (tx) => {
      const r = await readRole(tx, fd, admin.id);
      const before = await tx.user.findUniqueOrThrow({ where: { id }, include: { accessRole: true } });
      if (id === admin.id) {
        if (!active) throw new Error('You cannot deactivate your own account.');
        if (!r.isAdmin) throw new Error('You cannot remove your own Admin role. Ask another admin to do it.');
      }
      const wasAdmin = !!before.accessRole?.isAdmin;
      const removesAdmin = wasAdmin && before.active && (!r.isAdmin || !active);
      if (removesAdmin && (await otherActiveAdmins(tx, id)) === 0) {
        throw new Error('This is the last active admin. Make another user an admin first.');
      }
      await tx.user.update({ where: { id }, data: { name, role: r.role, accessRoleId: r.accessRoleId, active } });
      const after = { name, role: r.roleName, active };
      const beforeSafe = { name: before.name, role: before.accessRole?.name ?? null, active: before.active };
      await audit(tx, admin.id, 'UPDATE', 'User', id, `Updated user ${before.username}`, { before: beforeSafe, after });
    });
    revalidatePath(`/users/${id}`);
    revalidatePath('/users');
    return { ok: 'User saved.' };
  });
}

export async function resetPassword(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await assertUser('admin');
    const passwordHash = await bcrypt.hash(readPassword(fd), 10);
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data: { passwordHash } });
      await audit(tx, admin.id, 'RESET_PASSWORD', 'User', id, `Reset password of ${u.username}`);
    });
    return { ok: 'Password reset. Give the new password to the user and ask them to change it under My account.' };
  });
}
