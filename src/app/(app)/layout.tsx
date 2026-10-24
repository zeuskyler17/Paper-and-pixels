import { requireUser, getBranch } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Nav, type NavItem, type NavSection } from '@/components/Nav';
import { can, type Need } from '@/lib/permissions';
import { logout } from '../login/actions';

type MenuItem = NavItem & { need: Need | Need[] };
type MenuSection = { title: string; items: MenuItem[] };

/** The full menu; each user sees only the items their role's permissions allow. */
const MENU: MenuSection[] = [
  {
    title: 'Operations',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', need: 'dashboard' },
      { href: '/orders/new', label: 'New Order', icon: 'plus', need: 'orders' },
      { href: '/orders', label: 'Orders', icon: 'orders', need: 'orders' },
      { href: '/customers', label: 'Customers', icon: 'customers', need: 'customers' },
    ],
  },
  {
    title: 'Production',
    items: [
      { href: '/jobs', label: 'Production Board', icon: 'board', need: 'jobs_manage' },
      { href: '/deliveries', label: 'Deliveries', icon: 'truck', need: 'deliveries' },
      { href: '/products', label: 'Products & Pricing', icon: 'tag', need: ['products_view', 'products_edit'] },
    ],
  },
  {
    title: 'Supply Chain',
    items: [
      { href: '/inventory', label: 'Inventory', icon: 'boxes', need: 'inventory' },
      { href: '/inventory/out', label: 'Stock Out', icon: 'stockOut', need: 'inventory' },
      { href: '/inventory/convert', label: 'Cutting / Conversion', icon: 'scissors', need: 'inventory' },
      { href: '/purchase-orders', label: 'Purchase Orders', icon: 'po', need: 'purchasing' },
      { href: '/suppliers', label: 'Suppliers', icon: 'factory', need: 'purchasing' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/expenses', label: 'Expenses', icon: 'wallet', need: ['expenses', 'expenses_manage'] },
      { href: '/reports', label: 'Reports', icon: 'chart', need: ['reports', 'reports_daily', 'reports_sales', 'reports_production', 'reports_inventory'] },
    ],
  },
  {
    title: 'People',
    items: [
      { href: '/employees', label: 'Employees & Users', icon: 'idCard', need: ['hr', 'admin'] },
      { href: '/timekeeping', label: 'Timekeeping', icon: 'timesheet', need: 'hr' },
      { href: '/payroll', label: 'Payroll', icon: 'payroll', need: 'hr' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { href: '/audit', label: 'Audit Log', icon: 'shield', need: 'audit' },
      { href: '/settings', label: 'Settings', icon: 'gear', need: 'settings' },
    ],
  },
];

const today = () => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const branch = getBranch()!;
  const linkedEmployee = await prisma.employee.findUnique({ where: { userId: user.id }, select: { id: true } });

  const sections: NavSection[] = MENU
    .map((s) => ({ title: s.title, items: s.items.filter((i) => can(user, i.need) && !(branch.simpleInventory && i.href === '/inventory/convert')).map(({ need: _n, ...i }) => i) }))
    .filter((s) => s.items.length > 0);
  // Production workers without the full board get "My Jobs".
  if (!can(user, 'jobs_manage') && can(user, 'jobs_own')) {
    sections.unshift({ title: 'Production', items: [{ href: '/jobs', label: 'My Jobs', icon: 'wrench' }] });
  }
  // Everyone gets the time clock; "My time & pay" only when this login is linked to an employee record.
  sections.push({
    title: 'Me',
    items: [
      { href: '/clock', label: 'Time Clock', icon: 'clock' },
      { href: '/tutorial', label: 'Tutorial', icon: 'list' },
      ...(linkedEmployee ? [{ href: '/me', label: 'My Time & Pay', icon: 'user' } as const] : []),
    ],
  });
  // Merge a second "Production" section (My Jobs + e.g. Deliveries) into one.
  const merged: NavSection[] = [];
  for (const s of sections) {
    const same = merged.find((m) => m.title === s.title);
    if (same) same.items.push(...s.items); else merged.push({ ...s, items: [...s.items] });
  }

  return (
    <div className="min-h-screen">
      <Nav
        sections={merged}
        userName={user.name}
        roleLabel={user.roleName}
        logout={logout}
        today={today()}
        showSearch={can(user, 'orders')}
        brand={{ name: branch.name, logo: branch.logo, color: branch.color }}
      />
      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:ml-60 lg:px-8 lg:py-6">{children}</main>
    </div>
  );
}
