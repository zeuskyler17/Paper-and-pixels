import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { PrintHeader } from '@/components/PrintHeader';
import { fmtQty, peso } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { PO_STATUS } from '@/lib/labels';

export const metadata = { title: 'Purchase order' };

export default async function PrintPOPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('purchasing');
  const { id } = await params;
  const [po, s] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id: Number(id) || 0 },
      include: {
        supplier: true,
        createdBy: { select: { name: true } },
        items: { orderBy: { id: 'asc' }, include: { material: { select: { name: true, unit: true, sku: true } } } },
      },
    }),
    getSettings(),
  ]);
  if (!po) notFound();

  return (
    <div className="mx-auto w-[8.5in] max-w-full bg-white p-[8mm] text-[11px] leading-snug text-black shadow print:max-w-none print:p-0 print:shadow-none">
      <style>{`@page { size: 8.5in 5.5in; margin: 8mm; }`}</style>

      <PrintHeader s={s} title="Purchase Order" docNo={po.poNo} date={`Date: ${fmtDate(po.orderDate)}`} badge={po.status === 'CANCELLED' ? 'CANCELLED' : po.status === 'DRAFT' ? PO_STATUS.DRAFT : null} />

      <section className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Supplier</div>
          <div className="text-sm font-semibold">{po.supplier.name}</div>
          {po.supplier.address && <div>{po.supplier.address}</div>}
          {po.supplier.contactPerson && <div>Attn: {po.supplier.contactPerson}</div>}
          {[po.supplier.mobile, po.supplier.email].filter(Boolean).length > 0 && <div>{[po.supplier.mobile, po.supplier.email].filter(Boolean).join(' · ')}</div>}
        </div>
        <div className="text-right">
          <div><span className="text-slate-600">Expected delivery:</span> <strong>{fmtDate(po.expectedDate)}</strong></div>
          {po.supplier.paymentTerms && <div><span className="text-slate-600">Payment terms:</span> <strong>{po.supplier.paymentTerms}</strong></div>}
        </div>
      </section>

      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1.5 pr-2 w-8">#</th>
            <th className="py-1.5 pr-2">Item</th>
            <th className="py-1.5 pr-2 text-right">Qty</th>
            <th className="py-1.5 pr-2">Unit</th>
            <th className="py-1.5 pr-2 text-right">Unit cost</th>
            <th className="py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {po.items.map((i, idx) => (
            <tr key={i.id} className="border-b border-slate-300">
              <td className="py-1.5 pr-2">{idx + 1}</td>
              <td className="py-1.5 pr-2">{i.material.name}{i.material.sku && <span className="text-slate-600"> ({i.material.sku})</span>}</td>
              <td className="py-1.5 pr-2 text-right">{fmtQty(i.quantity)}</td>
              <td className="py-1.5 pr-2">{i.material.unit}</td>
              <td className="py-1.5 pr-2 text-right">{peso(i.unitCost)}</td>
              <td className="py-1.5 text-right">{peso(i.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black">
            <td colSpan={5} className="py-2 pr-2 text-right text-sm font-bold">TOTAL</td>
            <td className="py-2 text-right text-sm font-bold">{peso(po.total)}</td>
          </tr>
        </tfoot>
      </table>

      {po.notes && (
        <section className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Notes</div>
          <div className="whitespace-pre-wrap">{po.notes}</div>
        </section>
      )}

      <section className="mt-16 grid grid-cols-2 gap-12">
        <div>
          <div className="border-t border-black pt-1 text-center">{po.createdBy.name}</div>
          <div className="text-center text-[10px] uppercase tracking-wide text-slate-600">Prepared by</div>
        </div>
        <div>
          <div className="border-t border-black pt-1 text-center">&nbsp;</div>
          <div className="text-center text-[10px] uppercase tracking-wide text-slate-600">Approved by</div>
        </div>
      </section>
    </div>
  );
}
