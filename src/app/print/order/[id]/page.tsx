import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings, type Settings } from '@/lib/settings';
import { peso } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { FILE_SOURCE, ORDER_STATUS, PAYMENT_TERMS } from '@/lib/labels';
import { PrintHeader } from '@/components/PrintHeader';
import { SlipFooter } from '@/components/SlipFooter';
import { specsText } from '@/lib/pricing';

export const metadata = { title: 'Order slip' };

/** The three printouts of one order. "all" prints them one after another on A5 landscape pages.
 * A long item list is split over several pages of the same copy; every page repeats the letterhead and
 * customer details ("Page 1 of 2"), and the totals / signatures go on the copy's last page. */
const COPIES = {
  slip: { title: 'Order Slip', copy: 'Customer copy', sign: true },
  ack: { title: 'Acknowledgement Receipt', copy: 'Customer copy', sign: true },
  dup: { title: 'Order Slip — Duplicate', copy: 'Shop / production copy', sign: false },
} as const;
type CopyKey = keyof typeof COPIES;

export default async function OrderSlipPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ copy?: string }> }) {
  await requireUser('orders');
  const { id } = await params;
  const { copy } = await searchParams;
  const [order, s] = await Promise.all([
    prisma.order.findUnique({
      where: { id: Number(id) || 0 },
      include: {
        customer: { select: { name: true, isInternal: true } },
        createdBy: { select: { name: true } },
        items: { orderBy: { id: 'asc' }, include: { specs: { orderBy: { id: 'asc' } } } },
        payments: { where: { voided: false }, orderBy: { paidAt: 'asc' }, select: { receiptNo: true, amount: true, method: true, paidAt: true } },
      },
    }),
    getSettings(),
  ]);
  if (!order) notFound();
  const keys: CopyKey[] = copy && copy in COPIES ? [copy as CopyKey] : ['slip', 'ack', 'dup'];

  return (
    <>
      <style>{`
        @page { size: A5 landscape; margin: 7mm; }
        .slip { width: 210mm; min-height: 148mm; }
        .slip + .slip { margin-top: 16px; }
        @media print {
          .slip { width: auto; min-height: 0; box-shadow: none !important; padding: 0 !important; margin: 0 !important; break-after: page; page-break-after: always; }
          .slip:last-child { break-after: auto; page-break-after: auto; }
          .slip tr, .slip .keep { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
      <nav className="no-print mx-auto mb-3 flex w-[210mm] max-w-full flex-wrap items-center gap-1 text-[12.5px]">
        <span className="mr-1 font-semibold text-slate-600">Print:</span>
        {([['all', 'All 3 copies'], ['slip', 'Order slip'], ['ack', 'Acknowledgement receipt'], ['dup', 'Duplicate copy']] as const).map(([k, label]) => (
          <Link key={k} href={k === 'all' ? `/print/order/${order.id}` : `/print/order/${order.id}?copy=${k}`}
            className={`rounded px-2.5 py-1 font-semibold ${(k === 'all' && keys.length === 3) || keys[0] === k && keys.length === 1 ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100'}`}>{label}</Link>
        ))}
      </nav>
      {keys.flatMap((k) => {
        const pages = paginate(order, k);
        return pages.map((items, i) => <Slip key={`${k}-${i}`} order={order} s={s} kind={k} items={items} page={i + 1} pages={pages.length} />);
      })}
    </>
  );
}

type OrderDoc = NonNullable<Awaited<ReturnType<typeof loadType>>>;
type Item = OrderDoc['items'][number];

// Heights in mm, measured on A5 landscape (printable 134 mm): letterhead + customer lines + table header ≈ 42 mm,
// "Continued on page…" ≈ 5 mm, a one-line item ≈ 6.7 mm (+4.5 mm per wrapped line), closing part ≈ 31–41 mm.
const PAGE_ROWS = 134 - 42 - 5 - 3; // room for items on a page, with 3 mm to spare
const lines = (text: string, perLine = 95) => Math.max(1, Math.ceil(text.length / perLine));
function rowWeight(it: Item) {
  const text = `${it.description} — ${specsText(it.specs)}`;
  let mm = 6.7 + 4.5 * (lines(text) - 1);
  if (it.specsNotes) mm += 4.2 * it.specsNotes.split('\n').reduce((n, l) => n + lines(l, 120), 0);
  return mm;
}
function footerWeight(order: OrderDoc, kind: CopyKey) {
  let w = 31; // totals line, footer text, signature lines (in place of the 5 mm "continued" line)
  const files = order.items.filter((i) => i.fileSource !== 'NONE').length;
  if (files) w += 4.5 * (files + 1);
  if (order.notes) w += 4.5 * lines(order.notes, 120);
  if (kind === 'ack') w += 10 + (order.payments.length ? 4.5 * (order.payments.length + 1) : 0);
  if (kind === 'dup') w += 6; // production check boxes instead of the footer text
  return w;
}
/** Split the items into pages; the last page keeps room for the closing part. */
function paginate(order: OrderDoc, kind: CopyKey): Item[][] {
  const pages: Item[][] = [[]];
  let used = 0;
  for (const it of order.items) {
    const w = rowWeight(it);
    if (used + w > PAGE_ROWS && pages[pages.length - 1].length) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(it); used += w;
  }
  // Not enough room left for totals & signatures: move the last rows to a new final page.
  const footer = footerWeight(order, kind);
  const last = pages[pages.length - 1];
  const moved: Item[] = [];
  let lastUsed = last.reduce((n, it) => n + rowWeight(it), 0);
  while (lastUsed + footer > PAGE_ROWS && last.length > 1) { const it = last.pop()!; moved.unshift(it); lastUsed -= rowWeight(it); }
  if (lastUsed + footer > PAGE_ROWS && last.length === 1 && pages.length > 1) { moved.unshift(last.pop()!); pages.pop(); }
  if (moved.length) pages.push(moved);
  return pages;
}
// Typing helper only (never called): mirrors the query above so <Slip> gets the right shape.
async function loadType() {
  return prisma.order.findUnique({
    where: { id: 0 },
    include: {
      customer: { select: { name: true, isInternal: true } }, createdBy: { select: { name: true } },
      items: { include: { specs: true } },
      payments: { select: { receiptNo: true, amount: true, method: true, paidAt: true } },
    },
  });
}

function Slip({ order, s, kind, items, page, pages }: { order: OrderDoc; s: Settings; kind: CopyKey; items: Item[]; page: number; pages: number }) {
  const isLast = page === pages;
  const internal = order.customer.isInternal;
  const c = internal ? { ...COPIES[kind], title: kind === 'dup' ? 'Branch Transfer — Duplicate' : 'Branch Transfer Slip', copy: kind === 'dup' ? 'Shop / production copy' : 'Branch copy' } : COPIES[kind];
  const files = order.items.filter((i) => i.fileSource !== 'NONE');
  // The shop / production duplicate shows what to make, not money: no prices or totals at all.
  const prices = kind !== 'dup';
  return (
    <div className="slip mx-auto max-w-full bg-white p-[7mm] text-[10.5px] leading-snug text-black shadow">
      <PrintHeader s={s} title={c.title} docNo={order.orderNo} date={fmtDateTime(order.createdAt)} copy={pages > 1 ? `${c.copy} · Page ${page} of ${pages}` : c.copy} badge={order.status === 'CANCELLED' ? 'CANCELLED' : null} />

      {/* Customer, then target date · payment terms · prepared by on one line (no mobile number on printouts). */}
      <section className="space-y-0.5 border-b border-black py-1.5">
        <div><span className="font-semibold">Customer:</span> {order.customer.name}</div>
        <div className="flex flex-wrap gap-x-6 gap-y-0.5">
          <span><span className="font-semibold">Target date:</span> {fmtDate(order.targetDate)}</span>
          <span><span className="font-semibold">Payment terms:</span> {PAYMENT_TERMS[order.paymentTerms]}</span>
          {order.createdBy?.name && <span><span className="font-semibold">Prepared by:</span> {order.createdBy.name}</span>}
          {order.status !== 'PENDING' && order.status !== 'CANCELLED' && <span><span className="font-semibold">Status:</span> {ORDER_STATUS[order.status]}</span>}
        </div>
      </section>

      <table className="mt-1.5 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-0.5 pr-1">Item / specifications</th>
            <th className="w-8 py-0.5 text-right">Qty</th>
            {prices && <th className="w-20 py-0.5 text-right">Unit price</th>}
            {prices && <th className="w-20 py-0.5 text-right">Amount</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-dotted border-gray-500 align-top">
              <td className="py-1 pr-1 text-[12px]">
                {/* Item and its specifications on one line, a bit bigger than the rest of the slip. */}
                <span className="font-semibold">{it.description}{it.widthFt != null && it.heightFt != null ? ` — ${it.widthFt} × ${it.heightFt} ft` : ''}</span>
                {it.specs.length > 0 && <span> — {specsText(it.specs)}</span>}
                {it.specsNotes && <div className="whitespace-pre-line text-[10.5px] italic">{it.specsNotes}</div>}
              </td>
              <td className="py-1 text-right">{it.quantity}</td>
              {prices && <td className="py-1 text-right">{internal ? '—' : peso(it.unitPrice)}</td>}
              {prices && <td className="py-1 text-right">{internal ? '—' : peso(it.lineTotal)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {!isLast && <p className="mt-1.5 text-right text-[9.5px] font-semibold italic">Continued on page {page + 1}…</p>}

      {isLast && <>
      {/* Totals on one line to save height on the A5 page. */}
      {internal ? (
        <div className="mt-1.5 border-2 border-black p-1.5 text-center text-[11px] font-bold uppercase tracking-wide">Internal transfer — no charge</div>
      ) : prices && (
        <div className="keep mt-1.5 flex flex-wrap items-baseline justify-end gap-x-5 gap-y-0.5 border-y border-black py-1 whitespace-nowrap">
          <Tot k="Subtotal" v={peso(order.subtotal)} />
          {order.discount > 0 && <Tot k="Discount" v={`−${peso(order.discount)}`} />}
          {order.pointsAmount > 0 && <Tot k={`Points (${order.pointsUsed})`} v={`−${peso(order.pointsAmount)}`} />}
          <Tot k="TOTAL" v={peso(order.total)} strong />
          <Tot k="Amount paid" v={peso(order.amountPaid)} />
          <Tot k="BALANCE" v={peso(order.balance)} strong />
        </div>
      )}

      {(files.length > 0 || order.notes || (kind === 'ack' && order.payments.length > 0)) && <div className="mt-1.5 flex justify-between gap-4">
        <div className="flex-1">
          {files.length > 0 && (
            <div>
              <div className="font-semibold">File source:</div>
              {files.map((f) => <div key={f.id}>{f.description}: {FILE_SOURCE[f.fileSource]}{f.fileSourceNote ? ` — ${f.fileSourceNote}` : ''}</div>)}
            </div>
          )}
          {order.notes && <div className="mt-1"><span className="font-semibold">Notes:</span> {order.notes}</div>}
          {kind === 'ack' && order.payments.length > 0 && (
            <div className="mt-1">
              <div className="font-semibold">Payments received:</div>
              {order.payments.map((p) => <div key={p.receiptNo}>{p.receiptNo} · {fmtDate(p.paidAt)} · {p.method.replace('_', ' ')} · {peso(p.amount)}</div>)}
            </div>
          )}
        </div>
      </div>}

      {kind === 'ack' && !internal && (
        <p className="mt-2 border border-black p-1.5 text-center">
          This acknowledges receipt of <b>{peso(order.amountPaid)}</b> as {order.balance > 0 ? 'downpayment' : 'full payment'} for order <b>{order.orderNo}</b>.
          {order.balance > 0 && <> Balance of <b>{peso(order.balance)}</b> is due upon claiming.</>}
        </p>
      )}
      {kind === 'dup' && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[9.5px]">
          {['Proof Read / Inventory', 'Production done', 'QC / packed'].map((t) => <div key={t} className="border border-black p-1"><div className="h-5" /><div className="border-t border-black pt-0.5">{t}</div></div>)}
        </div>
      )}
      {s.receipt_footer && c.sign && <SlipFooter text={s.receipt_footer} className="mt-2 text-[8.5px] leading-snug" />}

      <div className="keep mt-6 grid grid-cols-2 gap-8">
        <div className="border-t border-black pt-1 text-center">{c.sign ? `Received by${order.createdBy?.name ? `: ${order.createdBy.name}` : ''}` : 'Prepared by'}</div>
        <div className="border-t border-black pt-1 text-center">{c.sign ? 'Customer signature' : 'Released by'}</div>
      </div>
      </>}
    </div>
  );
}

function Tot({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <span className={strong ? 'font-bold' : ''}>
      {k}: <span className={strong ? 'text-[12px]' : ''}>{v}</span>
    </span>
  );
}
