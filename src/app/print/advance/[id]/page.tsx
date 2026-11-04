import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { PrintHeader } from '@/components/PrintHeader';
import { SlipFooter } from '@/components/SlipFooter';
import { peso } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { PAYMENT_METHOD } from '@/lib/labels';
import { accountLabel } from '@/lib/paymentAccounts';
import { advanceBalance } from '@/lib/advance';

export const metadata = { title: 'Advance payment receipt' };

/** Acknowledgement receipt for an advance payment (money given before an order), with where it was used so far. */
export default async function AdvanceReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('orders');
  const { id } = await params;
  const [d, s] = await Promise.all([
    prisma.customerDeposit.findUnique({
      where: { id: Number(id) || 0 },
      include: {
        customer: { select: { id: true, name: true } }, receivedBy: { select: { name: true } }, account: true,
        uses: { orderBy: { id: 'asc' }, include: { payment: { select: { receiptNo: true, paidAt: true, voided: true, order: { select: { orderNo: true } } } } } },
      },
    }),
    getSettings(),
  ]);
  if (!d) notFound();
  const live = d.uses.filter((u) => !u.payment.voided);
  const used = live.reduce((s, u) => s + u.amount, 0);
  const balance = d.voided ? 0 : await advanceBalance(prisma, d.customer.id);

  return (
    <>
      <style>{`
        @page { size: 8.5in 5.5in; margin: 8mm; }
        .receipt { width: 8.5in; min-height: 5.5in; }
        @media print { .receipt { width: auto; min-height: 0; box-shadow: none !important; padding: 0 !important; } }
      `}</style>
      <div className="receipt relative mx-auto max-w-full overflow-hidden bg-white p-[8mm] text-[12px] leading-snug text-black shadow">
        {d.voided && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 border-8 border-gray-400 px-8 text-[90px] font-black tracking-widest text-gray-300 opacity-80">VOID</span>
          </div>
        )}
        <PrintHeader s={s} title="Acknowledgement Receipt — Advance Payment" docNo={d.receiptNo} date={fmtDateTime(d.receivedAt)} badge={d.voided ? 'VOID' : null} />

        <div className="relative mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <span className="self-center text-[13px] font-normal">Received from:</span><span className="text-[14.5px] font-semibold">{d.customer.name}</span>
          <span className="font-semibold">For:</span><span>Advance payment — to be applied to this customer&apos;s future order(s)</span>
          <span className="font-semibold">Amount:</span><span className="text-lg font-bold">{peso(d.amount)}</span>
          <span className="font-semibold">Method:</span><span>{PAYMENT_METHOD[d.method]}</span>
          {d.account && (<><span className="font-semibold">Received in:</span><span>{accountLabel(d.account)}{d.account.accountName ? ` (${d.account.accountName})` : ''}</span></>)}
          <span className="font-semibold">Reference no.:</span><span>{d.reference ?? '—'}</span>
          {d.notes && <><span className="font-semibold">Notes:</span><span>{d.notes}</span></>}
          {live.length > 0 && (
            <>
              <span className="font-semibold">Applied to:</span>
              <span>{live.map((u) => <div key={u.id}>{u.payment.order.orderNo} · receipt {u.payment.receiptNo} · {fmtDate(u.payment.paidAt)} · {peso(u.amount)}</div>)}</span>
              <span className="font-semibold">Unused from this receipt:</span><span>{peso(d.amount - used)}</span>
            </>
          )}
          {!d.voided && <><span className="font-semibold">Customer&apos;s advance balance:</span><span className="font-bold">{peso(balance)}</span></>}
          {d.voided && <><span className="font-semibold">VOIDED:</span><span>{fmtDateTime(d.voidedAt)} — {d.voidReason}</span></>}
        </div>

        {s.receipt_footer && <SlipFooter text={s.receipt_footer} className="mt-4 text-[11px]" />}

        <div className="mt-10 grid grid-cols-2 gap-10">
          <div className="border-t border-black pt-1 text-center">Received by: {d.receivedBy.name}</div>
          <div className="border-t border-black pt-1 text-center">Customer signature</div>
        </div>
      </div>
    </>
  );
}
