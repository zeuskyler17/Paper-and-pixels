import 'server-only';
import bcrypt from 'bcryptjs';
import type { Tx } from './db';
import { audit } from './audit';

export type LoginInput = { username: string; password: string; accessRoleId: number };

/** Username / role / password fields of a "create login" form. `prefix` lets other forms embed them (login_username…). */
export function readLoginInput(fd: FormData, prefix = ''): LoginInput {
  const username = String(fd.get(`${prefix}username`) ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Username must be 3–32 characters: lowercase letters, numbers, dot, dash or underscore.');
  const password = String(fd.get(`${prefix}password`) ?? '');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  if (fd.has(`${prefix}confirm`) && password !== String(fd.get(`${prefix}confirm`) ?? '')) throw new Error('Passwords do not match.');
  const accessRoleId = Number(fd.get(`${prefix}accessRoleId`));
  if (!accessRoleId) throw new Error('Choose a role for the login.');
  return { username, password, accessRoleId };
}

/** Creates a login (User). Admin only — the caller checks. Keeps the legacy enum role in sync. */
export async function createLoginTx(tx: Tx, adminId: number, name: string, input: LoginInput) {
  const role = await tx.accessRole.findUnique({ where: { id: input.accessRoleId } });
  if (!role) throw new Error('Choose a role for the login.');
  if (await tx.user.findUnique({ where: { username: input.username } })) throw new Error(`Username "${input.username}" is already taken.`);
  const passwordHash = await bcrypt.hash(input.password, 10);
  const u = await tx.user.create({ data: { name, username: input.username, role: role.isAdmin ? 'ADMIN' : 'STAFF', accessRoleId: role.id, passwordHash } });
  await audit(tx, adminId, 'CREATE', 'User', u.id, `Created user ${u.username} (${role.name})`, { name, username: u.username, role: role.name });
  return u;
}

/** "juan.delacruz" from a name — a starting point the admin can edit. */
export function suggestUsername(first: string, last: string) {
  const clean = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const u = [clean(first), clean(last)].filter(Boolean).join('.');
  return u.length >= 3 ? u.slice(0, 32) : '';
}
