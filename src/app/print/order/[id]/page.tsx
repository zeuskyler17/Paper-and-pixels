import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings, type Settings } from '@/lib/settings';
import { peso } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { FILE_SOURCE, ORDER_STATUS, PAYMENT_TERMS } from '@/lib/labels';
import { PrintHeader } from '@/components/PrintHeader';

export const metadata = { title: 'Order slip' };

/** The three printouts of one order. "all" prints them one after another, each on its own A5 page. */
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
        customer: true,
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
        @page { size: A5; margin: 7mm; }
        .slip { width: 148mm; min-height: 210mm; }
        .slip + .slip { margin-top: 16px; }
        @media print {
          .slip { width: auto; min-height: 0; box-shadow: none !important; padding: 0 !important; margin: 0 !important; break-after: page; page-break-after: always; }
          .slip:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      <nav className="no-print mx-auto mb-3 flex w-[148mm] max-w-full flex-wrap items-center gap-1 text-[12.5px]">
        <span className="mr-1 font-semibold text-slate-600">Print:</span>
        {([['all', 'All 3 copies'], ['slip', 'Order slip'], ['ack', 'Acknowledgement receipt'], ['dup', 'Duplicate copy']] as const).map(([k, label]) => (
          <Link key={k} href={k === 'all' ? `/print/order/${order.id}` : `/print/order/${order.id}?copy=${k}`}
            className={`rounded px-2.5 py-1 font-semibold ${(k === 'all' && keys.length === 3) || keys[0] === k && keys.length === 1 ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100'}`}>{label}</Link>
        ))}
      </nav>
      {keys.map((k) => <Slip key={k} order={order} s={s} kind={k} />)}
    </>
  );
}

type OrderDoc = NonNullable<Awaited<ReturnType<typeof loadType>>>;
// Typing helper only (never called): mirrors the query above so <Slip> gets the right shape.
async function loadType() {
  return prisma.order.findUnique({
    where: { id: 0 },
    include: {
      customer: true, createdBy: { select: { name: true } },
      items: { include: { specs: true } },
      payments: { select: { receiptNo: true, amount: true, method: true, paidAt: true } },
    },
  });
}

function Slip({ order, s, kind }: { order: OrderDoc; s: Settings; kind: CopyKey }) {
  const internal = order.customer.isInternal;
  const c = internal ? { ...COPIES[kind], title: kind === 'dup' ? 'Branch Transfer — Duplicate' : 'Branch Transfer Slip', copy: kind === 'dup' ? 'Shop / production copy' : 'Branch copy' } : COPIES[kind];
  const files = order.items.filter((i) => i.fileSource !== 'NONE');
  return (
    <div className="slip mx-auto max-w-full bg-white p-[7mm] text-[10.5px] leading-snug text-black shadow">
      <PrintHeader s={s} title={c.title} docNo={order.orderNo} date={fmtDateTime(order.createdAt)} copy={c.copy} badge={order.status === 'CANCELLED' ? 'CANCELLED' : null} />

      <section className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-b border-black py-1.5">
        <div><span className="font-semibold">Customer:</span> {order.customer.name}</div>
        <div><span className="font-semibold">Mobile:</span> {order.customer.mobile ?? '—'}</div>
        <div><span className="font-semibold">Target date:</span> {fmtDate(order.targetDate)}</div>
        <div><span className="font-semibold">Payment terms:</span> {PAYMENT_TERMS[order.paymentTerms]}</div>
        {order.status !== 'PENDING' && order.status !== 'CANCELLED' && <div><span className="font-semibold">Status:</span> {ORDER_STATUS[order.status]}</div>}
        {order.createdBy?.name && <div><span className="font-semibold">Prepared by:</span> {order.createdBy.name}</div>}
      </section>

      <table className="mt-1.5 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-0.5 pr-1">Item / specifications</th>
            <th className="w-8 py-0.5 text-right">Qty</th>
            <th className="w-20 py-0.5 text-right">Unit price</th>
            <th className="w-20 py-0.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((it) => (
            <tr key={it.id} className="border-b border-dotted border-gray-500 align-top">
              <td className="py-1 pr-1">
                <div className="font-semibold">{it.description}{it.widthFt != null && it.heightFt != null ? ` — ${it.widthFt} × ${it.heightFt} ft` : ''}</div>
                {it.specs.length > 0 && <div>{it.specs.map((sp) => `${sp.name}: ${sp.value}`).join('; ')}</div>}
                {it.specsNotes && <div className="whitespace-pre-line italic">{it.specsNotes}</div>}
              </td>
              <td className="py-1 text-right">{it.quantity}</td>
              <td className="py-1 text-right">{internal ? '—' : peso(it.unitPrice)}</td>
              <td className="py-1 text-right">{internal ? '—' : peso(it.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-1.5 flex justify-between gap-4">
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
        {internal ? (
          <div className="w-56 self-end border-2 border-black p-2 text-center text-[11px] font-bold uppercase tracking-wide">Internal transfer — no charge</div>
        ) : (
        <table className="w-48">
          <tbody>
            <Tot k="Subtotal" v={peso(order.subtotal)} />
            {order.discount > 0 && <Tot k="Discount" v={`−${peso(order.discount)}`} />}
            <Tot k="TOTAL" v={peso(order.total)} strong />
            <Tot k="Amount paid" v={peso(order.amountPaid)} />
            <Tot k="BALANCE" v={peso(order.balance)} strong />
          </tbody>
        </table>
        )}
      </div>

      {kind === 'ack' && !internal && (
        <p className="mt-2 border border-black p-1.5 text-center">
          This acknowledges receipt of <b>{peso(order.amountPaid)}</b> as {order.balance > 0 ? 'downpayment' : 'full payment'} for order <b>{order.orderNo}</b>.
          {order.balance > 0 && <> Balance of <b>{peso(order.balance)}</b> is due upon claiming.</>}
        </p>
      )}
      {kind === 'dup' && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[9.5px]">
          {['Layout / proof OK', 'Production done', 'QC / packed'].map((t) => <div key={t} className="border border-black p-1"><div className="h-5" /><div className="border-t border-black pt-0.5">{t}</div></div>)}
        </div>
      )}
      {s.receipt_footer && c.sign && <p className="mt-2 border-t border-black pt-1.5 text-center">{s.receipt_footer}</p>}

      <div className="mt-6 grid grid-cols-2 gap-8">
        <div className="border-t border-black pt-1 text-center">{c.sign ? `Received by${order.createdBy?.name ? `: ${order.createdBy.name}` : ''}` : 'Prepared by'}</div>
        <div className="border-t border-black pt-1 text-center">{c.sign ? 'Customer signature' : 'Checked by'}</div>
      </div>
    </div>
  );
}

function Tot({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <tr className={strong ? 'font-bold' : ''}>
      <td className="py-0.5 pr-2">{k}</td>
      <td className="py-0.5 text-right">{v}</td>
    </tr>
  );
}
