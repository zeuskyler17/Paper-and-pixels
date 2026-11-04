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

export const metadata = { title: 'Combined payment receipt' };

/** Acknowledgement receipt for one payment toward a customer's combined balance, with how it was split over the orders. */
export default async function CombinedReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('orders');
  const { id } = await params;
  const [cp, s] = await Promise.all([
    prisma.combinedPayment.findUnique({
      where: { id: Number(id) || 0 },
      include: {
        customer: { select: { name: true } }, receivedBy: { select: { name: true } }, account: true,
        payments: { orderBy: { id: 'asc' }, include: { order: { select: { orderNo: true, createdAt: true, total: true } } } },
      },
    }),
    getSettings(),
  ]);
  if (!cp) notFound();
  const live = cp.payments.filter((p) => !p.voided);
  const isVoid = live.length === 0;
  const applied = live.reduce((t, p) => t + p.amount, 0);

  return (
    <>
      <style>{`
        @page { size: 8.5in 5.5in; margin: 8mm; }
        .receipt { width: 8.5in; min-height: 5.5in; }
        @media print { .receipt { width: auto; min-height: 0; box-shadow: none !important; padding: 0 !important; } }
      `}</style>
      <div className="receipt relative mx-auto max-w-full overflow-hidden bg-white p-[8mm] text-[12px] leading-snug text-black shadow">
        {isVoid && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 border-8 border-gray-400 px-8 text-[90px] font-black tracking-widest text-gray-300 opacity-80">VOID</span>
          </div>
        )}
        <PrintHeader s={s} title="Acknowledgement Receipt — Combined Balance Payment" docNo={cp.receiptNo} date={fmtDateTime(cp.paidAt)} badge={isVoid ? 'VOID' : null} />

        <div className="relative mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <span className="self-center text-[13px] font-normal">Received from:</span><span className="text-[14.5px] font-semibold">{cp.customer.name}</span>
          <span className="font-semibold">For:</span><span>Payment toward the combined balance of {cp.payments.length} order{cp.payments.length === 1 ? '' : 's'}</span>
          <span className="font-semibold">Amount:</span><span className="text-lg font-bold">{peso(cp.amount)}</span>
          <span className="font-semibold">Method:</span><span>{PAYMENT_METHOD[cp.method]}</span>
          {cp.account && (<><span className="font-semibold">Received in:</span><span>{accountLabel(cp.account)}{cp.account.accountName ? ` (${cp.account.accountName})` : ''}</span></>)}
          <span className="font-semibold">Reference no.:</span><span>{cp.reference ?? '—'}</span>
          {cp.notes && <><span className="font-semibold">Notes:</span><span>{cp.notes}</span></>}
        </div>

        <table className="relative mt-3 w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1 text-left font-semibold">Order no.</th>
              <th className="py-1 text-left font-semibold">Order date</th>
              <th className="py-1 text-left font-semibold">Receipt</th>
              <th className="py-1 text-right font-semibold">Order total</th>
              <th className="py-1 text-right font-semibold">Applied</th>
            </tr>
          </thead>
          <tbody>
            {cp.payments.map((p) => (
              <tr key={p.id} className={`border-b border-gray-300 ${p.voided ? 'text-gray-400 line-through' : ''}`}>
                <td className="py-1">{p.order.orderNo}</td>
                <td className="py-1">{fmtDate(p.order.createdAt)}</td>
                <td className="py-1">{p.receiptNo}</td>
                <td className="py-1 text-right">{peso(p.order.total)}</td>
                <td className="py-1 text-right font-semibold">{peso(p.amount)}{p.voided && ' (void)'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="pt-1 text-right font-semibold">Total applied</td>
              <td className="pt-1 text-right font-bold">{peso(applied)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="relative mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
          <span className="font-semibold">Combined balance before:</span><span>{peso(cp.balanceBefore)}</span>
          {!isVoid && <><span className="font-semibold">Combined balance after:</span><span className="font-bold">{peso(Math.max(0, cp.balanceBefore - applied))}</span></>}
          {isVoid && <><span className="font-semibold">VOIDED:</span><span>{cp.payments[0]?.voidedAt ? fmtDateTime(cp.payments[0].voidedAt) : ''} — {cp.payments[0]?.voidReason}</span></>}
        </div>

        {s.receipt_footer && <SlipFooter text={s.receipt_footer} className="mt-4 text-[11px]" />}

        <div className="mt-8 grid grid-cols-2 gap-10">
          <div className="border-t border-black pt-1 text-center">Received by: {cp.receivedBy.name}</div>
          <div className="border-t border-black pt-1 text-center">Customer signature</div>
        </div>
      </div>
    </>
  );
}
