import Link from 'next/link';
import { fmtDate, todayManila } from '@/lib/dates';
import { centavosToInput, peso } from '@/lib/money';
import { PAYMENT_METHOD, options } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Empty, Field, Select, TableWrap } from '@/components/ui';
import { recordSupplierPayment, voidSupplierPayment } from './actions';

/** Form to record a supplier payment. Pass `poId` to lock it to one PO, or `pos` to offer a PO picker. */
export function SupplierPaymentForm({ supplierId, poId, pos, suggestedAmount }: {
  supplierId: number;
  poId?: number;
  pos?: { id: number; poNo: string }[];
  suggestedAmount?: number;
}) {
  return (
    <ActionForm action={recordSupplierPayment.bind(null, supplierId)} className="space-y-3" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₱) *">
          <input name="amount" inputMode="decimal" required className="input" defaultValue={suggestedAmount && suggestedAmount > 0 ? centavosToInput(suggestedAmount) : ''} />
        </Field>
        <Field label="Method *"><Select name="method" options={options(PAYMENT_METHOD)} defaultValue="CASH" required /></Field>
        <Field label="Reference" hint="GCash / bank ref, check no., OR no."><input name="reference" className="input" /></Field>
        <Field label="Date paid"><input name="paidAt" type="date" defaultValue={todayManila()} max={todayManila()} className="input" /></Field>
        {poId ? (
          <input type="hidden" name="purchaseOrderId" value={poId} />
        ) : pos && pos.length > 0 ? (
          <Field label="For purchase order"><Select name="purchaseOrderId" options={pos.map((p) => ({ value: p.id, label: p.poNo }))} placeholder="— general / no specific PO —" /></Field>
        ) : null}
        <Field label="Notes" className={poId || !pos?.length ? 'sm:col-span-2' : ''}><input name="notes" className="input" /></Field>
      </div>
      <SubmitButton>Record payment</SubmitButton>
    </ActionForm>
  );
}

export type SupplierPaymentRow = {
  id: number; amount: number; method: string; reference: string | null; notes: string | null; paidAt: Date;
  voided: boolean; voidReason: string | null; createdBy: { name: string };
  purchaseOrder?: { id: number; poNo: string } | null;
};

export function SupplierPaymentsTable({ rows, isAdmin, showPo = true }: { rows: SupplierPaymentRow[]; isAdmin: boolean; showPo?: boolean }) {
  if (rows.length === 0) return <Empty>No payments recorded.</Empty>;
  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr><th>Date</th>{showPo && <th>PO</th>}<th>Method</th><th>Notes</th><th>By</th><th className="text-right">Amount</th>{isAdmin && <th />}</tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={p.voided ? 'text-slate-400' : ''}>
              <td className="whitespace-nowrap">{fmtDate(p.paidAt)}</td>
              {showPo && <td>{p.purchaseOrder ? <Link href={`/purchase-orders/${p.purchaseOrder.id}`} className="link">{p.purchaseOrder.poNo}</Link> : '—'}</td>}
              <td className="whitespace-nowrap">{PAYMENT_METHOD[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</td>
              <td className="max-w-[16rem]">
                {p.notes ?? (p.voided ? '' : '—')}
                {p.voided && <div className="text-xs text-red-600">Voided: {p.voidReason}</div>}
              </td>
              <td className="whitespace-nowrap">{p.createdBy.name}</td>
              <td className={`whitespace-nowrap text-right font-medium ${p.voided ? 'line-through' : ''}`}>
                {peso(p.amount)} {p.voided && <Badge tone="red">Void</Badge>}
              </td>
              {isAdmin && (
                <td className="whitespace-nowrap">
                  {!p.voided && (
                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-red-600">Void</summary>
                      <ActionForm action={voidSupplierPayment.bind(null, p.id)} className="mt-2 flex w-56 flex-col gap-2" confirm="Void this payment? This cannot be undone.">
                        <input name="reason" required placeholder="Reason" className="input" />
                        <SubmitButton className="btn-danger btn-sm">Void payment</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
