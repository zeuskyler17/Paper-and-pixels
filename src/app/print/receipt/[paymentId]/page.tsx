import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { PrintHeader } from '@/components/PrintHeader';
import { peso } from '@/lib/money';
import { fmtDateTime } from '@/lib/dates';
import { PAYMENT_METHOD } from '@/lib/labels';
import { accountLabel } from '@/lib/paymentAccounts';

export const metadata = { title: 'Payment receipt' };

export default async function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) {
  await requireUser('orders');
  const { paymentId } = await params;
  const [p, s] = await Promise.all([
    prisma.payment.findUnique({
      where: { id: Number(paymentId) || 0 },
      include: { order: true, customer: true, receivedBy: { select: { name: true } }, account: true },
    }),
    getSettings(),
  ]);
  if (!p) notFound();

  return (
    <>
      <style>{`
        @page { size: A5 landscape; margin: 8mm; }
        .receipt { width: 210mm; min-height: 148mm; }
        @media print { .receipt { width: auto; min-height: 0; box-shadow: none !important; padding: 0 !important; } }
      `}</style>
      <div className="receipt relative mx-auto max-w-full overflow-hidden bg-white p-[8mm] text-[12px] leading-snug text-black shadow">
        {p.voided && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 border-8 border-gray-400 px-8 text-[90px] font-black tracking-widest text-gray-300 opacity-80">VOID</span>
          </div>
        )}
        <PrintHeader s={s} title="Acknowledgement Receipt" docNo={p.receiptNo} date={fmtDateTime(p.paidAt)} badge={p.voided ? 'VOID' : null} />

        <div className="relative mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <span className="font-semibold">Received from:</span><span>{p.customer.name}{p.customer.mobile ? ` (${p.customer.mobile})` : ''}</span>
          <span className="font-semibold">For order no.:</span><span>{p.order.orderNo}</span>
          <span className="font-semibold">Amount:</span><span className="text-lg font-bold">{peso(p.amount)}</span>
          <span className="font-semibold">Method:</span><span>{PAYMENT_METHOD[p.method]}</span>
          {p.account && (<><span className="font-semibold">Received in:</span><span>{accountLabel(p.account)}{p.account.accountName ? ` (${p.account.accountName})` : ''}</span></>)}
          <span className="font-semibold">Reference no.:</span><span>{p.reference ?? '—'}</span>
          {p.notes && <><span className="font-semibold">Notes:</span><span>{p.notes}</span></>}
          <span className="font-semibold">Order total:</span><span>{peso(p.order.total)}</span>
          <span className="font-semibold">Remaining balance:</span><span className="font-bold">{peso(p.order.balance)}</span>
          {p.voided && <><span className="font-semibold">VOIDED:</span><span>{fmtDateTime(p.voidedAt)} — {p.voidReason}</span></>}
        </div>

        {s.receipt_footer && <p className="mt-4 text-center text-[11px]">{s.receipt_footer}</p>}

        <div className="mt-10 grid grid-cols-2 gap-10">
          <div className="border-t border-black pt-1 text-center">Received by: {p.receivedBy.name}</div>
          <div className="border-t border-black pt-1 text-center">Customer signature</div>
        </div>
      </div>
    </>
  );
}
