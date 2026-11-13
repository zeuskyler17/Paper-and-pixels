// Duplicate customers: same name (ignoring case and spaces) or same mobile number.
import 'server-only';
import { prisma } from './db';

export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-10);

/** An existing customer a new one would duplicate: same mobile, or same name unless both have different mobiles
 * (two different people can share a name when their numbers differ). */
export async function findDuplicateCustomer(name: string, mobile: string | null) {
  const m = digits(mobile);
  const rows = await prisma.customer.findMany({
    where: { OR: [{ name: { equals: name.trim().replace(/\s+/g, ' '), mode: 'insensitive' } }, ...(m.length >= 7 ? [{ mobile: { contains: m.slice(-7) } }] : [])] },
    select: { id: true, name: true, mobile: true },
    take: 20,
  });
  return rows.find((c) => m.length >= 7 && digits(c.mobile) === m)
    ?? rows.find((c) => normName(c.name) === normName(name) && !(m && digits(c.mobile) && digits(c.mobile) !== m))
    ?? null;
}

export const duplicateMessage = (c: { name: string; mobile: string | null }) =>
  `Customer "${c.name}"${c.mobile ? ` (${c.mobile})` : ''} already exists — search and pick them instead. If this is a different person, add their mobile number or a different name.`;

/** Groups of customers sharing the same name (for the owner's "Possible duplicates" list). */
export async function duplicateGroups() {
  const all = await prisma.customer.findMany({ select: { id: true, name: true, mobile: true, isInternal: true, _count: { select: { orders: true } } }, orderBy: { id: 'asc' } });
  const g = new Map<string, typeof all>();
  for (const c of all) g.set(normName(c.name), [...(g.get(normName(c.name)) ?? []), c]);
  return [...g.values()].filter((x) => x.length > 1);
}
