// Shared data builders for every report. Used by the report pages AND /api/export/[report],
// so what you see on screen is exactly what you export.
import 'server-only';
import { prisma } from '@/lib/db';
import { round3 } from '@/lib/money';
import { addDays, daysBetween, fmtDate, isOverdue, manilaRange, parseDateInput, startOfMonthManila, toDateInput, todayManila } from '@/lib/dates';
import { MATERIAL_LEVEL, MOVEMENT_TYPE, PAYMENT_METHOD } from '@/lib/labels';
import { can, type Access, type Permission } from '@/lib/permissions';
import { rollLength } from '@/lib/rolls';
import { groupSpecs } from '@/lib/pricing';

export type ColType = 'text' | 'money' | 'number' | 'date';
export type Column = { key: string; label: string; type: ColType };
/** Money values are CENTAVOS; dates are "YYYY-MM-DD" strings. `_href` (optional) links the first cell. */
export type Row = Record<string, string | number | null>;
export type ReportTable = { title?: string; columns: Column[]; rows: Row[]; totals?: Row };
export type ReportData = ReportTable & {
  title: string;
  /** Period description shown on screen / in the export header. */
  period: string;
  notes?: string[];
  /** Additional tables (e.g. per-product breakdown). */
  extra?: ReportTable[];
};

export type ReportParams = { from: string; to: string; group?: string };

export const REPORTS = {
  daily: { title: 'Daily report', description: 'One day: sales collected less expenses, payments, receiving accounts, products and items sold.', usesRange: false, singleDay: true },
  sales: { title: 'Sales summary', description: 'Orders, gross & net sales, discounts and collections by day, week or month.', usesRange: true },
  'sales-by-category': { title: 'Sales by product category', description: 'Quantity and amount sold per category and per product.', usesRange: true },
  payments: { title: 'Payments collected by method', description: 'Cash, GCash, Maya, bank transfer… (non-voided payments).', usesRange: true },
  receivables: { title: 'Accounts receivable', description: 'Who owes what, with aging 0–30 / 31–60 / 60+ days.', usesRange: false },
  expenses: { title: 'Expenses by category', description: 'Non-voided expenses grouped by category.', usesRange: true },
  profit: { title: 'Profit summary', description: 'Net sales less expenses and material cost.', usesRange: true },
  inventory: { title: 'Inventory valuation & movement', description: 'Stock on hand, value, and stock movements in the period.', usesRange: true },
  workers: { title: 'Worker productivity', description: 'Jobs completed, average turnaround, work in process and overdue jobs.', usesRange: true },
  printing: { title: 'Photo printing', description: 'Prints per size and paper type, and the roll paper used (length, rolls, cost).', usesRange: true },
} as const;

export type ReportKey = keyof typeof REPORTS;

/** "All reports" opens everything; the production / inventory report permissions open just their report. */
const REPORT_ACCESS: Partial<Record<ReportKey, Permission | Permission[]>> = { workers: 'reports_production', inventory: 'reports_inventory', printing: ['reports_production', 'reports_inventory'], sales: 'reports_sales', 'sales-by-category': 'reports_sales', daily: 'reports_daily' };
export const ANY_REPORT: Permission[] = ['reports', 'reports_daily', 'reports_sales', 'reports_production', 'reports_inventory'];

export function canSeeReport(user: Access, key: ReportKey): boolean {
  const extra = REPORT_ACCESS[key];
  return can(user, extra ? ['reports', ...(Array.isArray(extra) ? extra : [extra])] : 'reports');
}

export function isReportKey(k: string): k is ReportKey {
  return Object.prototype.hasOwnProperty.call(REPORTS, k);
}

/** Validate from/to search params (defaults: this month to date). */
export function normalizeParams(sp: { from?: string | null; to?: string | null; group?: string | null }): ReportParams {
  let to = sp.to && parseDateInput(sp.to) ? sp.to : todayManila();
  // No "from" (e.g. the Daily report's single day picker): start of month, or the day itself when it is earlier.
  let from = sp.from && parseDateInput(sp.from) ? sp.from : (to < startOfMonthManila() ? to : startOfMonthManila());
  if (from > to) [from, to] = [to, from];
  const group = sp.group === 'weekly' || sp.group === 'monthly' ? sp.group : 'daily';
  return { from, to, group };
}

function periodLabel(p: ReportParams) {
  return p.from === p.to ? fmtDate(parseDateInput(p.from)) : `${fmtDate(parseDateInput(p.from))} – ${fmtDate(parseDateInput(p.to))}`;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Monday of the Manila week containing dateStr. */
export function mondayOf(dateStr: string): string {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

/** viewerIsAdmin: owners / admins also see customers whose balance is hidden from staff. */
export async function buildReport(key: ReportKey, p: ReportParams, viewerIsAdmin = false): Promise<ReportData> {
  switch (key) {
    case 'daily': return dailyReport(p.to);
    case 'sales': return salesSummary(p);
    case 'sales-by-category': return salesByCategory(p);
    case 'payments': return paymentsByMethod(p);
    case 'receivables': return receivables(viewerIsAdmin);
    case 'expenses': return expensesByCategory(p);
    case 'profit': return profitSummary(p);
    case 'inventory': return inventoryReport(p);
    case 'workers': return workerProductivity(p);
    case 'printing': return photoPrinting(p);
  }
}

// ───────────── 1. Sales summary ─────────────

async function salesSummary(p: ReportParams): Promise<ReportData> {
  const { start, end } = manilaRange(p.from, p.to);
  const [orders, payments] = await Promise.all([
    prisma.order.findMany({
      where: { createdAt: { gte: start, lt: end }, status: { not: 'CANCELLED' }, customer: { isInternal: false } },
      select: { createdAt: true, subtotal: true, discount: true, total: true },
    }),
    prisma.payment.findMany({ where: { paidAt: { gte: start, lt: end }, voided: false }, select: { paidAt: true, amount: true } }),
  ]);

  const keyOf = (d: Date) => {
    const day = toDateInput(d);
    if (p.group === 'monthly') return day.slice(0, 7) + '-01';
    if (p.group === 'weekly') return mondayOf(day);
    return day;
  };
  type G = { orders: number; gross: number; discount: number; net: number; collected: number };
  const groups = new Map<string, G>();
  const get = (k: string) => {
    let g = groups.get(k);
    if (!g) { g = { orders: 0, gross: 0, discount: 0, net: 0, collected: 0 }; groups.set(k, g); }
    return g;
  };
  for (const o of orders) {
    const g = get(keyOf(o.createdAt));
    g.orders += 1; g.gross += o.subtotal; g.discount += o.discount; g.net += o.total;
  }
  for (const pay of payments) get(keyOf(pay.paidAt)).collected += pay.amount;

  const label = (k: string) => {
    const d = parseDateInput(k);
    if (p.group === 'monthly') return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long' }).format(d!);
    if (p.group === 'weekly') return `Week of ${fmtDate(d)}`;
    return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).format(d!);
  };
  const rows: Row[] = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, g]) => ({
    period: label(k), start: k, orders: g.orders, gross: g.gross, discount: g.discount, net: g.net, collected: g.collected,
  }));
  const groupWord = p.group === 'monthly' ? 'Month' : p.group === 'weekly' ? 'Week' : 'Day';

  return {
    title: REPORTS.sales.title,
    period: `${periodLabel(p)} · grouped by ${groupWord.toLowerCase()}`,
    columns: [
      { key: 'period', label: groupWord, type: 'text' },
      { key: 'start', label: 'Start date', type: 'date' },
      { key: 'orders', label: 'Orders', type: 'number' },
      { key: 'gross', label: 'Gross sales', type: 'money' },
      { key: 'discount', label: 'Discounts', type: 'money' },
      { key: 'net', label: 'Net sales', type: 'money' },
      { key: 'collected', label: 'Collected', type: 'money' },
    ],
    rows,
    totals: {
      period: 'Total', start: null,
      orders: sum(rows.map((r) => r.orders as number)), gross: sum(rows.map((r) => r.gross as number)),
      discount: sum(rows.map((r) => r.discount as number)), net: sum(rows.map((r) => r.net as number)),
      collected: sum(rows.map((r) => r.collected as number)),
    },
    notes: [
      'Sales are counted on the order date; cancelled orders are excluded.',
      'Collected = non-voided payments received in the period (may include payments for older orders).',
      p.from === p.to
        ? 'Products sold / items sold use line amounts before the order-level discount.'
        : 'Tip: choose a single day (e.g. "Today") to also see which products were sold.',
    ],
    // One day: also show how the day's money came in (cash-up), then what was sold.
    extra: p.from === p.to
      ? [await paymentsByMethodTable(start, end), await paymentsByAccount(start, end), ...(await productsSoldTables(start, end))]
      : undefined,
  };
}

/** One-day detail for the sales summary: what was sold, per product and per order line. */
async function productsSoldTables(start: Date, end: Date): Promise<ReportTable[]> {
  const items = await prisma.orderItem.findMany({
    where: { order: { createdAt: { gte: start, lt: end }, status: { not: 'CANCELLED' }, customer: { isInternal: false } } },
    orderBy: [{ order: { createdAt: 'asc' } }, { id: 'asc' }],
    select: {
      description: true, quantity: true, unitPrice: true, lineTotal: true, widthFt: true, heightFt: true, specsNotes: true,
      productId: true,
      product: { select: { name: true, category: { select: { name: true } } } },
      specs: { select: { name: true, value: true } },
      order: { select: { id: true, orderNo: true, createdAt: true, customer: { select: { name: true } } } },
    },
  });

  const time = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
  const detailRows: Row[] = items.map((it) => {
    const parts = [
      it.widthFt && it.heightFt ? `${it.widthFt} × ${it.heightFt} ft` : null,
      ...groupSpecs(it.specs).map(([n, v]) => `${n}: ${v}`),
      it.specsNotes,
    ].filter(Boolean);
    return {
      _href: `/orders/${it.order.id}`,
      orderNo: it.order.orderNo,
      time: time.format(it.order.createdAt),
      customer: it.order.customer.name,
      product: it.description,
      details: parts.join('; '),
      qty: it.quantity,
      unitPrice: it.unitPrice,
      amount: it.lineTotal,
    };
  });

  const byProduct = new Map<number, { product: string; category: string; qty: number; amount: number; orders: Set<number> }>();
  for (const it of items) {
    const g = byProduct.get(it.productId) ?? { product: it.product.name, category: it.product.category.name, qty: 0, amount: 0, orders: new Set<number>() };
    g.qty += it.quantity; g.amount += it.lineTotal; g.orders.add(it.order.id);
    byProduct.set(it.productId, g);
  }
  const productRows: Row[] = [...byProduct.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((g) => ({ product: g.product, category: g.category, orders: g.orders.size, qty: g.qty, amount: g.amount }));

  return [
    {
      title: 'Products sold',
      columns: [
        { key: 'product', label: 'Product', type: 'text' },
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'orders', label: 'Orders', type: 'number' },
        { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows: productRows,
      totals: {
        product: 'Total', category: null, orders: new Set(items.map((i) => i.order.id)).size,
        qty: sum(productRows.map((r) => r.qty as number)), amount: sum(productRows.map((r) => r.amount as number)),
      },
    },
    {
      title: 'Items sold (details)',
      columns: [
        { key: 'orderNo', label: 'Order no.', type: 'text' },
        { key: 'time', label: 'Time', type: 'text' },
        { key: 'customer', label: 'Customer', type: 'text' },
        { key: 'product', label: 'Product', type: 'text' },
        { key: 'details', label: 'Details', type: 'text' },
        { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'unitPrice', label: 'Unit price', type: 'money' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows: detailRows,
      totals: {
        orderNo: 'Total', time: null, customer: null, product: null, details: null,
        qty: sum(detailRows.map((r) => r.qty as number)), unitPrice: null, amount: sum(detailRows.map((r) => r.amount as number)),
      },
    },
  ];
}

// ───────────── 2. Sales by product category ─────────────

async function salesByCategory(p: ReportParams): Promise<ReportData> {
  const { start, end } = manilaRange(p.from, p.to);
  const items = await prisma.orderItem.findMany({
    where: { order: { createdAt: { gte: start, lt: end }, status: { not: 'CANCELLED' }, customer: { isInternal: false } } },
    select: { quantity: true, lineTotal: true, productId: true, product: { select: { name: true, category: { select: { name: true, sortOrder: true } } } } },
  });

  const cats = new Map<string, { qty: number; amount: number; lines: number; sort: number }>();
  const prods = new Map<number, { category: string; product: string; qty: number; amount: number }>();
  for (const it of items) {
    const cn = it.product.category.name;
    const c = cats.get(cn) ?? { qty: 0, amount: 0, lines: 0, sort: it.product.category.sortOrder };
    c.qty += it.quantity; c.amount += it.lineTotal; c.lines += 1;
    cats.set(cn, c);
    const pr = prods.get(it.productId) ?? { category: cn, product: it.product.name, qty: 0, amount: 0 };
    pr.qty += it.quantity; pr.amount += it.lineTotal;
    prods.set(it.productId, pr);
  }
  const totalAmount = sum([...cats.values()].map((c) => c.amount));
  const rows: Row[] = [...cats.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([name, c]) => ({ category: name, lines: c.lines, qty: c.qty, amount: c.amount, share: totalAmount ? Math.round((c.amount / totalAmount) * 1000) / 10 : 0 }));
  const prodRows: Row[] = [...prods.values()]
    .sort((a, b) => a.category.localeCompare(b.category) || b.amount - a.amount)
    .map((x) => ({ category: x.category, product: x.product, qty: x.qty, amount: x.amount }));

  return {
    title: REPORTS['sales-by-category'].title,
    period: periodLabel(p),
    columns: [
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'lines', label: 'Order lines', type: 'number' },
      { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'share', label: 'Share %', type: 'number' },
    ],
    rows,
    totals: { category: 'Total', lines: sum(rows.map((r) => r.lines as number)), qty: sum(rows.map((r) => r.qty as number)), amount: totalAmount, share: totalAmount ? 100 : 0 },
    extra: [{
      title: 'By product',
      columns: [
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'product', label: 'Product', type: 'text' },
        { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows: prodRows,
      totals: { category: 'Total', product: null, qty: sum(prodRows.map((r) => r.qty as number)), amount: totalAmount },
    }],
    notes: ['Amounts are line totals before order-level discounts. Cancelled orders are excluded.'],
  };
}

// ───────────── 3. Payments by method ─────────────

/** Non-voided payments per method (cash, GCash, …) in [start, end). Shared by the payments report and the one-day sales summary. */
async function paymentsByMethodTable(start: Date, end: Date): Promise<ReportTable> {
  const grouped = await prisma.payment.groupBy({
    by: ['method'],
    where: { paidAt: { gte: start, lt: end }, voided: false },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const byMethod = new Map(grouped.map((g) => [g.method as string, g]));
  const total = sum(grouped.map((g) => g._sum.amount ?? 0));
  const rows: Row[] = Object.entries(PAYMENT_METHOD).map(([m, label]) => {
    const g = byMethod.get(m);
    const amount = g?._sum.amount ?? 0;
    return { method: label, count: g?._count._all ?? 0, amount, share: total ? Math.round((amount / total) * 1000) / 10 : 0 };
  });
  return {
    title: 'Payments collected by method',
    columns: [
      { key: 'method', label: 'Method', type: 'text' },
      { key: 'count', label: 'Payments', type: 'number' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'share', label: 'Share %', type: 'number' },
    ],
    rows,
    totals: { method: 'Total', count: sum(rows.map((r) => r.count as number)), amount: total, share: total ? 100 : 0 },
  };
}

async function paymentsByMethod(p: ReportParams): Promise<ReportData> {
  const { start, end } = manilaRange(p.from, p.to);
  const t = await paymentsByMethodTable(start, end);
  return {
    ...t,
    title: REPORTS.payments.title,
    period: periodLabel(p),
    notes: [
      'Based on the payment date. Voided payments are excluded.',
      '"By receiving account" shows which GCash / Maya / bank account got the money (set up accounts in Settings → Payment accounts).',
    ],
    extra: [await paymentsByAccount(start, end)],
  };
}

/** Non-cash payments per receiving account (GCash / Maya / bank) in the period. */
async function paymentsByAccount(start: Date, end: Date): Promise<ReportTable> {
  const grouped = await prisma.payment.groupBy({
    by: ['method', 'accountId'],
    where: { paidAt: { gte: start, lt: end }, voided: false, method: { not: 'CASH' } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const accounts = await prisma.paymentAccount.findMany({ where: { id: { in: grouped.map((g) => g.accountId).filter((x): x is number => x !== null) } } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rows: Row[] = grouped
    .map((g) => {
      const a = g.accountId ? byId.get(g.accountId) : null;
      return {
        method: PAYMENT_METHOD[g.method],
        account: a ? a.label : '— not specified —',
        number: a?.accountNumber ?? '',
        name: a?.accountName ?? '',
        count: g._count._all,
        amount: g._sum.amount ?? 0,
      };
    })
    .sort((x, y) => String(x.method).localeCompare(String(y.method)) || (y.amount as number) - (x.amount as number));
  return {
    title: 'By receiving account',
    columns: [
      { key: 'method', label: 'Method', type: 'text' },
      { key: 'account', label: 'Received in', type: 'text' },
      { key: 'number', label: 'Number', type: 'text' },
      { key: 'name', label: 'Account name', type: 'text' },
      { key: 'count', label: 'Payments', type: 'number' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    rows,
    totals: { method: 'Total', account: null, number: null, name: null, count: sum(rows.map((r) => r.count as number)), amount: sum(rows.map((r) => r.amount as number)) },
  };
}

// ───────────── 4. Accounts receivable ─────────────

async function receivables(viewerIsAdmin: boolean): Promise<ReportData> {
  const t = await receivablesTable(viewerIsAdmin);
  return {
    ...t,
    title: REPORTS.receivables.title,
    period: `As of ${fmtDate(new Date())}`,
    notes: ['Aging is based on each order’s creation date. Cancelled orders are excluded. The date range does not apply to this report.'],
  };
}

/** Customers who still owe, with aging (as of now). */
async function receivablesTable(viewerIsAdmin = false): Promise<ReportTable> {
  const orders = await prisma.order.findMany({
    where: { status: { not: 'CANCELLED' }, balance: { gt: 0 }, customer: { isInternal: false, ...(viewerIsAdmin ? {} : { balanceHidden: false }) } },
    select: { createdAt: true, balance: true, customerId: true, customer: { select: { name: true, mobile: true } } },
  });
  const now = new Date();
  type G = { name: string; mobile: string; orders: number; oldest: Date; balance: number; b30: number; b60: number; b60p: number };
  const map = new Map<number, G>();
  for (const o of orders) {
    const g = map.get(o.customerId) ?? { name: o.customer.name, mobile: o.customer.mobile ?? '', orders: 0, oldest: o.createdAt, balance: 0, b30: 0, b60: 0, b60p: 0 };
    const age = daysBetween(o.createdAt, now);
    g.orders += 1; g.balance += o.balance;
    if (o.createdAt < g.oldest) g.oldest = o.createdAt;
    if (age <= 30) g.b30 += o.balance; else if (age <= 60) g.b60 += o.balance; else g.b60p += o.balance;
    map.set(o.customerId, g);
  }
  const rows: Row[] = [...map.entries()].sort((a, b) => b[1].balance - a[1].balance).map(([id, g]) => ({
    _href: `/customers/${id}`, customer: g.name, mobile: g.mobile, orders: g.orders, oldest: toDateInput(g.oldest),
    balance: g.balance, b30: g.b30, b60: g.b60, b60p: g.b60p,
  }));
  const s = (k: string) => sum(rows.map((r) => r[k] as number));
  return {
    title: `Receivables — customers who owe (as of ${fmtDate(now)})`,
    columns: [
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'mobile', label: 'Mobile', type: 'text' },
      { key: 'orders', label: 'Open orders', type: 'number' },
      { key: 'oldest', label: 'Oldest order', type: 'date' },
      { key: 'balance', label: 'Total balance', type: 'money' },
      { key: 'b30', label: '0–30 days', type: 'money' },
      { key: 'b60', label: '31–60 days', type: 'money' },
      { key: 'b60p', label: 'Over 60 days', type: 'money' },
    ],
    rows,
    totals: { customer: 'Total', mobile: null, orders: s('orders'), oldest: null, balance: s('balance'), b30: s('b30'), b60: s('b60'), b60p: s('b60p') },
  };
}

// ───────────── 5. Expenses by category ─────────────

async function expensesByCategory(p: ReportParams): Promise<ReportData> {
  const { start, end } = manilaRange(p.from, p.to);
  const [grouped, cats] = await Promise.all([
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: { date: { gte: start, lt: end }, voided: false },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expenseCategory.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(cats.map((c) => [c.id, c.name]));
  const total = sum(grouped.map((g) => g._sum.amount ?? 0));
  const rows: Row[] = grouped
    .map((g) => ({ category: names.get(g.categoryId) ?? `#${g.categoryId}`, count: g._count._all, amount: g._sum.amount ?? 0 }))
    .sort((a, b) => b.amount - a.amount)
    .map((r) => ({ ...r, share: total ? Math.round((r.amount / total) * 1000) / 10 : 0 }));
  return {
    title: REPORTS.expenses.title,
    period: periodLabel(p),
    columns: [
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'count', label: 'Entries', type: 'number' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'share', label: 'Share %', type: 'number' },
    ],
    rows,
    totals: { category: 'Total', count: sum(rows.map((r) => r.count as number)), amount: total, share: total ? 100 : 0 },
    notes: ['Voided expenses are excluded.'],
  };
}

// ───────────── 6. Profit summary ─────────────

async function profitSummary(p: ReportParams): Promise<ReportData> {
  const { start, end } = manilaRange(p.from, p.to);
  const [sales, expenseAgg, materialsCat, movements] = await Promise.all([
    prisma.order.aggregate({ where: { createdAt: { gte: start, lt: end }, status: { not: 'CANCELLED' }, customer: { isInternal: false } }, _sum: { total: true } }),
    prisma.expense.aggregate({ where: { date: { gte: start, lt: end }, voided: false }, _sum: { amount: true } }),
    prisma.expense.aggregate({
      where: { date: { gte: start, lt: end }, voided: false, category: { name: { equals: 'Materials', mode: 'insensitive' } } },
      _sum: { amount: true },
    }),
    prisma.stockMovement.findMany({
      where: { createdAt: { gte: start, lt: end }, type: { in: ['JOB_DEDUCT', 'STOCK_OUT'] }, returnedAt: null },
      select: { type: true, quantity: true, unitCost: true },
    }),
  ]);
  const netSales = sales._sum.total ?? 0;
  const expenses = expenseAgg._sum.amount ?? 0;
  const materialsExpenses = materialsCat._sum.amount ?? 0;
  const cost = (t: string) => Math.round(sum(movements.filter((m) => m.type === t).map((m) => -(m.quantity * m.unitCost))));
  const jobMaterial = cost('JOB_DEDUCT');
  const otherMaterial = cost('STOCK_OUT');
  const profit = netSales - expenses - jobMaterial - otherMaterial;

  const rows: Row[] = [
    { item: 'Net sales (order totals after discounts)', sign: '', amount: netSales },
    { item: 'Expenses (all categories, non-voided)', sign: '−', amount: expenses },
    { item: `   of which "Materials" category (info only, already included above)`, sign: '', amount: materialsExpenses },
    { item: 'Material cost — used on jobs (job deductions)', sign: '−', amount: jobMaterial },
    { item: 'Other material usage (manual stock out)', sign: '−', amount: otherMaterial },
  ];
  return {
    title: REPORTS.profit.title,
    period: periodLabel(p),
    columns: [
      { key: 'item', label: 'Component', type: 'text' },
      { key: 'sign', label: '', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    rows,
    totals: { item: 'Estimated profit', sign: '=', amount: profit },
    notes: [
      'Profit = Net sales − Expenses − Material cost (job deductions) − Other material usage.',
      'Material cost uses the unit cost recorded on each stock movement.',
      'If you also log material purchases as expenses in the "Materials" category, that amount may overlap with the material cost lines (the same materials counted twice). Both are shown so you can judge.',
      'Sales are on an accrual basis (order date), not cash collected — see the Sales summary for collections.',
    ],
  };
}

// ───────────── 7. Inventory valuation & movement ─────────────

const MOVE_KEYS = ['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'CONVERSION_IN', 'CONVERSION_OUT', 'JOB_DEDUCT'] as const;

async function inventoryReport(p: ReportParams): Promise<ReportData> {
  const { start, end } = manilaRange(p.from, p.to);
  const [materials, movements] = await Promise.all([
    prisma.material.findMany({ orderBy: [{ level: 'asc' }, { name: 'asc' }] }),
    prisma.stockMovement.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { materialId: true, type: true, quantity: true, unitCost: true },
    }),
  ]);
  const perMat = new Map<number, Record<string, number>>();
  const perType = new Map<string, { count: number; value: number }>();
  for (const m of movements) {
    const r = perMat.get(m.materialId) ?? {};
    r[m.type] = (r[m.type] ?? 0) + m.quantity;
    perMat.set(m.materialId, r);
    const t = perType.get(m.type) ?? { count: 0, value: 0 };
    t.count += 1; t.value += m.quantity * m.unitCost;
    perType.set(m.type, t);
  }
  const rows: Row[] = materials
    .filter((m) => m.active || m.stock !== 0 || perMat.has(m.id))
    .map((m) => {
      const mv = perMat.get(m.id) ?? {};
      const row: Row = {
        _href: `/inventory/${m.id}`,
        material: m.active ? m.name : `${m.name} (inactive)`, level: MATERIAL_LEVEL[m.level] ?? m.level, unit: m.unit,
        stock: round3(m.stock), unitCost: m.unitCost, value: Math.round(m.stock * m.unitCost),
      };
      for (const k of MOVE_KEYS) row[k] = round3(mv[k] ?? 0);
      return row;
    });
  const totals: Row = { material: 'Total', level: null, unit: null, stock: null, unitCost: null, value: sum(rows.map((r) => r.value as number)) };
  for (const k of MOVE_KEYS) totals[k] = null;

  const typeRows: Row[] = MOVE_KEYS.map((k) => ({ type: MOVEMENT_TYPE[k], count: perType.get(k)?.count ?? 0, value: Math.round(perType.get(k)?.value ?? 0) }));

  return {
    title: REPORTS.inventory.title,
    period: `Stock as of now · movements ${periodLabel(p)}`,
    columns: [
      { key: 'material', label: 'Material', type: 'text' },
      { key: 'level', label: 'Level', type: 'text' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'stock', label: 'Current stock', type: 'number' },
      { key: 'unitCost', label: 'Unit cost', type: 'money' },
      { key: 'value', label: 'Value', type: 'money' },
      ...MOVE_KEYS.map((k): Column => ({ key: k, label: MOVEMENT_TYPE[k], type: 'number' })),
    ],
    rows,
    totals,
    extra: [{
      title: 'Movement totals by type (in the period)',
      columns: [
        { key: 'type', label: 'Movement type', type: 'text' },
        { key: 'count', label: 'Movements', type: 'number' },
        { key: 'value', label: 'Value (+ in / − out)', type: 'money' },
      ],
      rows: typeRows,
    }],
    notes: [
      'Movement quantities are in each material’s unit: positive = in, negative = out.',
      'Value = current stock × weighted-average unit cost.',
    ],
  };
}

// ───────────── 8. Worker productivity ─────────────

async function workerProductivity(p: ReportParams): Promise<ReportData> {
  const { start, end } = manilaRange(p.from, p.to);
  const [workers, completed, open] = await Promise.all([
    prisma.user.findMany({ where: { OR: [{ accessRole: { isAdmin: false, permissions: { has: 'jobs_own' } } }, { jobsAssigned: { some: {} } }] }, select: { id: true, name: true, active: true }, orderBy: { name: 'asc' } }),
    prisma.job.findMany({
      where: { status: 'COMPLETED', completedAt: { gte: start, lt: end } },
      select: { assignedToId: true, createdAt: true, completedAt: true },
    }),
    prisma.job.findMany({
      where: { status: { in: ['PENDING', 'IN_PROCESS', 'QUALITY_CHECK'] } },
      select: { assignedToId: true, status: true, dueDate: true },
    }),
  ]);
  type G = { done: number; days: number; inProcess: number; overdue: number };
  const map = new Map<number | null, G>();
  const get = (id: number | null) => {
    let g = map.get(id);
    if (!g) { g = { done: 0, days: 0, inProcess: 0, overdue: 0 }; map.set(id, g); }
    return g;
  };
  for (const j of completed) {
    const g = get(j.assignedToId);
    g.done += 1;
    g.days += (j.completedAt!.getTime() - j.createdAt.getTime()) / 86_400_000;
  }
  for (const j of open) {
    const g = get(j.assignedToId);
    if (j.status === 'IN_PROCESS' || j.status === 'QUALITY_CHECK') g.inProcess += 1;
    if (isOverdue(j.dueDate)) g.overdue += 1;
  }
  const rowFor = (name: string, g: G | undefined): Row => ({
    worker: name, done: g?.done ?? 0,
    avgDays: g && g.done ? Math.round((g.days / g.done) * 10) / 10 : null,
    inProcess: g?.inProcess ?? 0, overdue: g?.overdue ?? 0,
  });
  const rows: Row[] = workers
    .map((w) => rowFor(w.active ? w.name : `${w.name} (inactive)`, map.get(w.id)))
    .filter((r, i) => workers[i].active || (r.done as number) + (r.inProcess as number) + (r.overdue as number) > 0);
  if (map.has(null)) rows.push(rowFor('(Unassigned)', map.get(null)));

  const totalDone = completed.length;
  const totalDays = sum([...map.values()].map((g) => g.days));
  return {
    title: REPORTS.workers.title,
    period: periodLabel(p),
    columns: [
      { key: 'worker', label: 'Worker', type: 'text' },
      { key: 'done', label: 'Jobs completed', type: 'number' },
      { key: 'avgDays', label: 'Avg days created → completed', type: 'number' },
      { key: 'inProcess', label: 'In process now (incl. QC)', type: 'number' },
      { key: 'overdue', label: 'Overdue now', type: 'number' },
    ],
    rows,
    totals: {
      worker: 'Total', done: totalDone, avgDays: totalDone ? Math.round((totalDays / totalDone) * 10) / 10 : null,
      inProcess: sum(rows.map((r) => r.inProcess as number)), overdue: sum(rows.map((r) => r.overdue as number)),
    },
    notes: [
      'Completed jobs are counted by completion date in the period. "In process" and "Overdue" are current counts (not limited to the period).',
      'Overdue = not completed/cancelled and past its due date.',
    ],
  };
}

// ───────────── 9. Photo printing ─────────────

/** Order lines of products that print on roll paper (a BOM line to a material with a roll length), ordered in the period. */
async function photoPrinting(p: ReportParams): Promise<ReportData> {
  const { start, end } = manilaRange(p.from, p.to);
  const rollMaterial = { rollLengthM: { not: null } } as const;
  const [items, outside] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        order: { createdAt: { gte: start, lt: end }, status: { not: 'CANCELLED' } },
        OR: [
          { product: { bom: { some: { material: rollMaterial } } } },
          { job: { stockMovements: { some: { type: 'JOB_DEDUCT', material: rollMaterial } } } },
        ],
      },
      select: {
        description: true, quantity: true, orderId: true,
        specs: { select: { name: true, value: true } },
        job: {
          select: {
            status: true,
            stockMovements: { where: { type: 'JOB_DEDUCT', returnedAt: null, material: rollMaterial }, select: { quantity: true, unitCost: true, material: { select: { id: true, name: true, unit: true, rollLengthM: true } } } },
          },
        },
      },
    }),
    // "Record a print outside an order" on the Photo paper rolls page.
    prisma.stockMovement.findMany({
      where: { createdAt: { gte: start, lt: end }, type: 'STOCK_OUT', notes: { startsWith: 'Printed ' }, material: rollMaterial },
      select: { quantity: true, unitCost: true, material: { select: { id: true, name: true, unit: true, rollLengthM: true } } },
    }),
  ]);

  type Mat = { id: number; name: string; unit: string; rollLengthM: number | null };
  type G = { size: string; paper: string; material: Mat | null; orders: Set<number>; prints: number; pending: number; length: number; cost: number };
  const groups = new Map<string, G>();
  type U = { material: Mat; prints: number; length: number; cost: number; outside: number };
  const used = new Map<number, U>();
  const useOf = (m: Mat) => { let u = used.get(m.id); if (!u) { u = { material: m, prints: 0, length: 0, cost: 0, outside: 0 }; used.set(m.id, u); } return u; };

  for (const it of items) {
    const size = it.specs.find((sp) => /size/i.test(sp.name))?.value ?? it.description;
    const paper = it.specs.find((sp) => /paper|photo type|finish/i.test(sp.name))?.value ?? '—';
    const moves = it.job?.stockMovements ?? [];
    const material = moves[0]?.material ?? null;
    const key = `${size}|${paper}|${material?.id ?? 0}`;
    let g = groups.get(key);
    if (!g) { g = { size, paper, material, orders: new Set(), prints: 0, pending: 0, length: 0, cost: 0 }; groups.set(key, g); }
    g.orders.add(it.orderId); g.prints += it.quantity;
    if (moves.length === 0) g.pending += it.quantity; // job not started yet — nothing deducted
    for (const mv of moves) {
      g.length += -mv.quantity; g.cost += -mv.quantity * mv.unitCost;
      const u = useOf(mv.material); u.length += -mv.quantity; u.cost += -mv.quantity * mv.unitCost;
    }
    if (material) useOf(material).prints += it.quantity - (moves.length === 0 ? it.quantity : 0);
  }
  for (const mv of outside) { const u = useOf(mv.material); u.length += -mv.quantity; u.cost += -mv.quantity * mv.unitCost; u.outside += -mv.quantity; }

  const rolls = (len: number, m: Mat | null) => (m && rollLength(m) ? Math.round((len / rollLength(m)) * 100) / 100 : null);
  const rows: Row[] = [...groups.values()]
    .sort((a, b) => b.prints - a.prints || a.size.localeCompare(b.size))
    .map((g) => ({
      size: g.size, paper: g.paper, orders: g.orders.size, prints: g.prints, pending: g.pending,
      material: g.material?.name ?? (g.pending ? 'not yet printed' : '—'),
      length: g.length ? round3(g.length) : null, unit: g.material?.unit ?? null, rolls: g.length ? rolls(g.length, g.material) : null, cost: Math.round(g.cost),
    }));
  const totals: Row = {
    size: 'Total', paper: null, orders: new Set(items.map((i) => i.orderId)).size, prints: sum(rows.map((r) => r.prints as number)), pending: sum(rows.map((r) => r.pending as number)),
    material: null, length: null, unit: null, rolls: null, cost: sum(rows.map((r) => r.cost as number)),
  };
  const usedRows: Row[] = [...used.values()].sort((a, b) => b.length - a.length).map((u) => ({
    _href: `/inventory/${u.material.id}`, material: u.material.name, prints: u.prints, length: round3(u.length), unit: u.material.unit,
    rolls: rolls(u.length, u.material), outside: u.outside ? round3(u.outside) : null, cost: Math.round(u.cost),
  }));

  return {
    title: REPORTS.printing.title,
    period: `Orders placed ${periodLabel(p)}`,
    columns: [
      { key: 'size', label: 'Size', type: 'text' },
      { key: 'paper', label: 'Paper', type: 'text' },
      { key: 'orders', label: 'Orders', type: 'number' },
      { key: 'prints', label: 'Prints', type: 'number' },
      { key: 'pending', label: 'Not yet printed', type: 'number' },
      { key: 'material', label: 'Roll used', type: 'text' },
      { key: 'length', label: 'Length used', type: 'number' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'rolls', label: 'Rolls', type: 'number' },
      { key: 'cost', label: 'Paper cost', type: 'money' },
    ],
    rows,
    totals,
    extra: [{
      title: 'Roll paper used (in the period)',
      columns: [
        { key: 'material', label: 'Roll', type: 'text' },
        { key: 'prints', label: 'Prints', type: 'number' },
        { key: 'length', label: 'Length used', type: 'number' },
        { key: 'unit', label: 'Unit', type: 'text' },
        { key: 'rolls', label: 'Rolls', type: 'number' },
        { key: 'outside', label: 'Of which outside orders', type: 'number' },
        { key: 'cost', label: 'Paper cost', type: 'money' },
      ],
      rows: usedRows,
      totals: { material: 'Total', prints: sum(usedRows.map((r) => r.prints as number)), length: null, unit: null, rolls: null, outside: null, cost: sum(usedRows.map((r) => r.cost as number)) },
    }],
    notes: [
      'Prints come from order lines of products that use roll paper (Photo Print and your own print sizes). Paper is deducted when the job is started, so "Not yet printed" lines show no length yet.',
      'Length used is what the bill of materials deducted (print length × prints); Rolls = length ÷ roll length. Paper cost uses the roll’s cost at the time of printing.',
      '"Outside orders" are lengths recorded with "Record a print outside an order" on the Photo paper rolls page.',
    ],
  };
}

// ───────────── Daily report ─────────────

/**
 * One day for the counter: money collected less expenses, every payment, receiving accounts,
 * products sold and the items in detail. Branch transfers (₱0) are excluded.
 */
async function dailyReport(day: string): Promise<ReportData> {
  const { start, end } = manilaRange(day, day);
  const [payments, expenses, byAccount, sold] = await Promise.all([
    prisma.payment.findMany({
      where: { paidAt: { gte: start, lt: end }, voided: false },
      orderBy: { paidAt: 'asc' },
      select: {
        receiptNo: true, paidAt: true, amount: true, method: true, reference: true,
        account: { select: { label: true } }, receivedBy: { select: { name: true } },
        customer: { select: { name: true } }, order: { select: { id: true, orderNo: true } },
      },
    }),
    prisma.expense.findMany({
      where: { date: { gte: start, lt: end }, voided: false },
      orderBy: { createdAt: 'asc' },
      select: { amount: true, paidVia: true, notes: true, otherDetail: true, category: { select: { name: true } }, createdBy: { select: { name: true } } },
    }),
    paymentsByAccount(start, end),
    productsSoldTables(start, end),
  ]);
  const time = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });

  const collected = sum(payments.map((p) => p.amount));
  const spent = sum(expenses.map((e) => e.amount));
  const cashIn = sum(payments.filter((p) => p.method === 'CASH').map((p) => p.amount));
  const cashOut = sum(expenses.filter((e) => e.paidVia === 'CASH').map((e) => e.amount));
  const methods = Object.entries(PAYMENT_METHOD)
    .map(([m, label]) => ({ label, amount: sum(payments.filter((p) => p.method === m).map((p) => p.amount)), count: payments.filter((p) => p.method === m).length }))
    .filter((m) => m.count > 0);

  const summary: Row[] = [
    { item: 'Sales collected (all payments)', count: payments.length, amount: collected },
    ...methods.map((m) => ({ item: `   · ${m.label}`, count: m.count, amount: m.amount })),
    { item: 'Less: expenses', count: expenses.length, amount: -spent },
    { item: 'NET — sales collected less expenses', count: null, amount: collected - spent },
    { item: 'Cash on hand today (cash collected − cash expenses)', count: null, amount: cashIn - cashOut },
  ];

  const paymentRows: Row[] = payments.map((p) => ({
    _href: `/orders/${p.order.id}`,
    receipt: p.receiptNo, time: time.format(p.paidAt), customer: p.customer.name, orderNo: p.order.orderNo,
    method: PAYMENT_METHOD[p.method], account: p.method === 'CASH' ? 'Cash drawer' : p.account?.label ?? '— not specified —',
    reference: p.reference ?? '', by: p.receivedBy.name, amount: p.amount,
  }));
  const expenseRows: Row[] = expenses.map((e) => ({
    category: e.category.name, details: [e.otherDetail, e.notes].filter(Boolean).join(' — '), via: PAYMENT_METHOD[e.paidVia], by: e.createdBy.name, amount: e.amount,
  }));

  return {
    title: REPORTS.daily.title,
    period: fmtDate(parseDateInput(day)),
    columns: [
      { key: 'item', label: 'Summary', type: 'text' },
      { key: 'count', label: 'Count', type: 'number' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    rows: summary,
    extra: [
      {
        title: 'Daily sales collected (payments received)',
        columns: [
          { key: 'receipt', label: 'Receipt', type: 'text' },
          { key: 'time', label: 'Time', type: 'text' },
          { key: 'customer', label: 'Customer', type: 'text' },
          { key: 'orderNo', label: 'Order', type: 'text' },
          { key: 'method', label: 'Method', type: 'text' },
          { key: 'account', label: 'Received in', type: 'text' },
          { key: 'reference', label: 'Reference', type: 'text' },
          { key: 'by', label: 'Received by', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'money' },
        ],
        rows: paymentRows,
        totals: { receipt: 'Total', time: null, customer: null, orderNo: null, method: null, account: null, reference: null, by: null, amount: collected },
      },
      {
        title: 'Expenses',
        columns: [
          { key: 'category', label: 'Category', type: 'text' },
          { key: 'details', label: 'Details', type: 'text' },
          { key: 'via', label: 'Paid via', type: 'text' },
          { key: 'by', label: 'Recorded by', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'money' },
        ],
        rows: expenseRows,
        totals: { category: 'Total', details: null, via: null, by: null, amount: spent },
      },
      { ...byAccount, title: 'By receiving account (GCash / Maya / bank — cash is in the summary)' },
      ...sold,
    ],
    notes: [
      'Sales collected = payments received on this day (by payment date), including balances paid on older orders. Voided payments and expenses are excluded.',
      'Products sold and items sold are orders created on this day (cancelled orders and branch transfers excluded); amounts are before order discounts.',
    ],
  };
}
