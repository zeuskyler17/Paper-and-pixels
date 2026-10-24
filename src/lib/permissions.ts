// Module-level permissions for custom roles. Safe on client and server.
// The Admin (owner) role is locked to full access; every other role is a set of these keys.
// Always allowed for any logged-in user (no checkbox): Time Clock, My Time & Pay, My account.

export const PERMISSIONS = [
  { key: 'dashboard', group: 'Operations', label: 'Dashboard', hint: 'Operations overview: today’s sales, jobs, low stock, unpaid customers' },
  { key: 'dashboard_money', group: 'Operations', label: 'Dashboard money tiles', hint: 'Total receivables and this month’s sales vs expenses' },
  { key: 'orders', group: 'Operations', label: 'Orders & payments', hint: 'New order, orders, payments, order slips and receipts. Voids and discounts still need the owner’s approval PIN.' },
  { key: 'orders_override', group: 'Operations', label: 'Release orders with unpaid balance', hint: 'Mark an order delivered while a balance is still owed (with a reason)' },
  { key: 'customers', group: 'Operations', label: 'Customers', hint: 'Customer list, details and history' },
  { key: 'jobs_manage', group: 'Production', label: 'Production board (all jobs)', hint: 'See every job, assign workers, cancel jobs' },
  { key: 'jobs_own', group: 'Production', label: 'My jobs (production worker)', hint: 'Can be assigned jobs and sees only their own jobs; appears in worker lists' },
  { key: 'deliveries', group: 'Production', label: 'Deliveries', hint: 'Delivery / pickup records and delivery slips' },
  { key: 'products_view', group: 'Production', label: 'Products & pricing (view)', hint: 'See the price list' },
  { key: 'products_edit', group: 'Production', label: 'Products & pricing (edit)', hint: 'Change prices, options, categories and bills of materials' },
  { key: 'inventory', group: 'Supply chain', label: 'Inventory & stock out', hint: 'Materials, stock in / out, counts, cutting / conversion, movements' },
  { key: 'purchasing', group: 'Supply chain', label: 'Purchase orders & suppliers', hint: 'POs, receiving, suppliers and supplier payments' },
  { key: 'expenses', group: 'Finance', label: 'Expenses (record)', hint: 'Add expenses and view the expense list' },
  { key: 'expenses_manage', group: 'Finance', label: 'Void expenses & categories', hint: 'Void expenses and edit expense categories' },
  { key: 'reports', group: 'Reports', label: 'All reports & Excel export', hint: 'Every report: sales, payments, receivables, expenses, profit, inventory, worker productivity' },
  { key: 'reports_daily', group: 'Reports', label: 'Daily report', hint: 'One day: sales collected less expenses, payments, receiving accounts, products and items sold' },
  { key: 'reports_sales', group: 'Reports', label: 'Sales reports', hint: 'Sales summary and sales by product category (no profit, expenses or receivables)' },
  { key: 'reports_production', group: 'Reports', label: 'Production reports', hint: 'Worker productivity: jobs completed, turnaround, work in process, overdue jobs' },
  { key: 'reports_inventory', group: 'Reports', label: 'Inventory reports', hint: 'Inventory valuation & movement: stock on hand, value, stock in / out in the period' },
  { key: 'hr', group: 'People', label: 'Employees, timekeeping & payroll', hint: 'Employee records, time records & selfies, payroll, incidents' },
  { key: 'audit', group: 'Administration', label: 'Audit log', hint: 'Who changed what and when' },
  { key: 'settings', group: 'Administration', label: 'Settings', hint: 'Shop details, receipts, payment accounts, time clock options' },
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'];
/** Admin-only things that are never delegated (users & roles, approval PINs). */
export type Need = Permission | 'admin';

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);
export const PERMISSION_GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))];

export function isPermission(k: string): k is Permission {
  return (ALL_PERMISSIONS as string[]).includes(k);
}

export type Access = { isAdmin: boolean; permissions: readonly string[] };

export function can(user: Access | null | undefined, need: Need | Need[]): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  const needs = Array.isArray(need) ? need : [need];
  return needs.some((n) => n !== 'admin' && user.permissions.includes(n));
}

/** Where a user lands after login / when a page is not allowed. */
export function homeFor(user: Access): string {
  if (can(user, 'dashboard')) return '/dashboard';
  if (can(user, 'jobs_manage')) return '/jobs';
  if (can(user, 'orders')) return '/orders';
  if (can(user, 'inventory')) return '/inventory/out';
  if (can(user, 'jobs_own')) return '/jobs';
  if (can(user, 'customers')) return '/customers';
  if (can(user, 'expenses')) return '/expenses';
  if (can(user, 'deliveries')) return '/deliveries';
  if (can(user, 'purchasing')) return '/purchase-orders';
  if (can(user, ['reports', 'reports_daily', 'reports_sales', 'reports_production', 'reports_inventory'])) return '/reports';
  if (can(user, 'hr')) return '/employees';
  return '/clock';
}

/** Today's access of the built-in roles — used for the presets created by the migration / seed. */
export const PRESET_ROLES: { name: string; description: string; legacy: 'STAFF' | 'WORKER' | 'INVENTORY'; permissions: Permission[] }[] = [
  {
    name: 'Cashier / Staff', legacy: 'STAFF', description: 'Counter staff: orders, payments, customers, production board, deliveries, inventory, purchasing, expenses.',
    permissions: ['dashboard', 'orders', 'customers', 'jobs_manage', 'deliveries', 'products_view', 'inventory', 'purchasing', 'expenses', 'reports_daily'],
  },
  { name: 'Production worker', legacy: 'WORKER', description: 'Sees and works on their own assigned jobs.', permissions: ['jobs_own'] },
  { name: 'Inventory personnel', legacy: 'INVENTORY', description: 'Stockroom: materials, stock out, counts and conversions. Can also be assigned production jobs.', permissions: ['inventory', 'jobs_own'] },
];

/** Extra ready-made roles (not tied to an old enum value). */
export const EXTRA_PRESET_ROLES: { name: string; description: string; permissions: Permission[] }[] = [
  { name: 'Production Supervisor', description: 'Runs the production floor: all jobs, assigning workers, deliveries, plus production reports.', permissions: ['jobs_manage', 'jobs_own', 'deliveries', 'products_view', 'reports_production'] },
  { name: 'Inventory Supervisor', description: 'Runs the stockroom: inventory, stock out, purchasing, plus inventory reports.', permissions: ['inventory', 'purchasing', 'reports_inventory', 'jobs_own'] },
];

/** Prisma filter: active users who can be assigned production jobs ("My jobs" permission, not Admin). */
export const ASSIGNABLE_WORKER = { active: true, accessRole: { isAdmin: false, permissions: { has: 'jobs_own' } } } as const;
