import 'server-only';
import type { Tx } from './db';
import { audit } from './audit';
import { isPermission } from './permissions';

/** Read a role's name / description / ticked permissions from a form. `prefix` lets the user form embed the fields. */
export function readRoleInput(fd: FormData, prefix = '') {
  const name = String(fd.get(`${prefix}name`) ?? '').trim();
  if (!name) throw new Error('Give the role a name, e.g. "Front desk" or "Helper".');
  if (name.length > 60) throw new Error('Role name is too long.');
  const description = String(fd.get(`${prefix}description`) ?? '').trim() || null;
  const permissions = [...new Set(fd.getAll(`${prefix}perm`).map(String).filter(isPermission))];
  return { name, description, permissions };
}

export async function createRoleTx(tx: Tx, adminId: number, data: ReturnType<typeof readRoleInput>) {
  if (await tx.accessRole.findUnique({ where: { name: data.name } })) throw new Error(`A role named "${data.name}" already exists — pick it from the list instead.`);
  const max = await tx.accessRole.aggregate({ _max: { sortOrder: true } });
  const r = await tx.accessRole.create({ data: { ...data, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  await audit(tx, adminId, 'CREATE', 'AccessRole', r.id, `Created role ${r.name} (${data.permissions.length} permissions)`, data);
  return r;
}
