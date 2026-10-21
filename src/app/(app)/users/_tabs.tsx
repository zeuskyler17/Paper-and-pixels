import Link from 'next/link';
import { can, type Access } from '@/lib/permissions';

/**
 * Employees · Logins · Roles & access — one "People" area. Employees needs the HR permission,
 * logins and roles are admin-only; each person sees only the tabs they can open.
 */
export function PeopleTabs({ active, user }: { active: 'employees' | 'users' | 'roles'; user: Access }) {
  const tabs = [
    { key: 'employees', label: 'Employees', href: '/employees', show: can(user, 'hr') },
    { key: 'users', label: 'Logins (users)', href: '/users', show: can(user, 'admin') },
    { key: 'roles', label: 'Roles & access', href: '/users/roles', show: can(user, 'admin') },
  ] as const;
  const visible = tabs.filter((t) => t.show);
  if (visible.length < 2) return null;
  return (
    <div className="mb-4 flex gap-1 border-b border-slate-200">
      {visible.map((t) => (
        <Link key={t.key} href={t.href}
          className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-semibold ${active === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export async function roleOptions() {
  const { prisma } = await import('@/lib/db');
  const roles = await prisma.accessRole.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return roles.map((r) => ({ id: r.id, name: r.name, isAdmin: r.isAdmin, permissions: r.permissions }));
}
