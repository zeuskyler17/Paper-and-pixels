import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { PrintHeader } from '@/components/PrintHeader';
import { SlipFooter } from '@/components/SlipFooter';
import { peso } from '@/lib/money';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { DELIVERY_METHOD, DELIVERY_STATUS } from '@/lib/labels';
import { specsText } from '@/lib/pricing';

export const metadata = { title: 'Delivery slip' };

export default async function DeliverySlipPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(['deliveries', 'orders']);
  const { id } = await params;
  const deliveryId = Number(id);
  if (!Number.isInteger(deliveryId)) notFound();

  const [d, s] = await Promise.all([
    prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        order: {
          select: {
            orderNo: true, balance: true, status: true,
            customer: { select: { name: true, mobile: true } },
            items: {
              orderBy: { id: 'asc' },
              select: { id: true, description: true, quantity: true, widthFt: true, heightFt: true, specs: { select: { name: true, value: true }, orderBy: { id: 'asc' } } },
            },
          },
        },
      },
    }),
    getSettings(),
  ]);
  if (!d) notFound();

  const balance = d.order.status === 'CANCELLED' ? 0 : d.order.balance;
  const row = (label: string, value: React.ReactNode) => (
    <tr><td className="w-[30%] py-0.5 pr-2 align-top text-black">{label}</td><td className="py-0.5 font-medium">{value || '—'}</td></tr>
  );

  return (
    <div className="mx-auto w-[8.5in] max-w-full bg-white p-[8mm] text-[11px] leading-snug text-black shadow print:w-auto print:p-0 print:shadow-none">
      <style>{'@page { size: 8.5in 5.5in; margin: 8mm }'}</style>

      <PrintHeader s={s} title={d.method === 'PICKUP' ? 'Pickup slip' : 'Delivery slip'} docNo={d.order.orderNo} date={`Slip #${d.id} · printed ${fmtDateTime(new Date())}`} badge={d.status === 'CANCELLED' ? 'CANCELLED' : null} />

      <div className="mt-1.5 text-right text-[10px]">Status: {DELIVERY_STATUS[d.status]}</div>

      <table className="mt-2 w-full">
        <tbody>
          {row('Customer', [d.order.customer.name, d.order.customer.mobile].filter(Boolean).join(' · '))}
          {row('Recipient', d.recipient)}
          {row('Contact no.', d.contactNo)}
          {row('Address', d.address)}
          {row('Method', DELIVERY_METHOD[d.method])}
          {row('Rider / courier', d.rider)}
          {row('Tracking no.', d.trackingNo)}
          {row('Scheduled', fmtDate(d.scheduledDate))}
          {d.notes && row('Notes', <span className="whitespace-pre-wrap">{d.notes}</span>)}
        </tbody>
      </table>

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1 pr-2">Item</th>
            <th className="w-12 py-1 text-right">Qty</th>
          </tr>
        </thead>
        <tbody>
          {d.order.items.map((it) => (
            <tr key={it.id} className="border-b border-gray-500 align-top">
              <td className="py-1 pr-2">
                <div className="font-medium">{it.description}{it.widthFt && it.heightFt ? ` (${it.widthFt} × ${it.heightFt} ft)` : ''}</div>
                {it.specs.length > 0 && <div className="text-[10px] text-black">{specsText(it.specs)}</div>}
              </td>
              <td className="py-1 text-right font-medium">{it.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {balance > 0 && (
        <div className="mt-3 border-2 border-black p-2 text-center text-sm font-bold">
          Balance to collect: {peso(balance)}
        </div>
      )}

      <div className="mt-10 grid grid-cols-2 gap-6">
        <div>
          <div className="border-t border-black pt-1 text-center">Released by</div>
        </div>
        <div>
          <div className="border-t border-black pt-1 text-center">Received by (signature over printed name) / Date</div>
        </div>
      </div>

      {s.receipt_footer && <SlipFooter text={s.receipt_footer} className="mt-4 text-[10px]" />}
    </div>
  );
}
