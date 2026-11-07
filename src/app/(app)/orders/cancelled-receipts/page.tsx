import Link from 'next/link';
import { requireUser, can } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDateTime } from '@/lib/dates';
import { PAYMENT_METHOD } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Card, Empty, PageHeader, TableWrap } from '@/components/ui';
import { voidedReceipts } from '@/lib/voidedReceipts';
import { markAllVoidsSeen, markVoidSeen } from '../actions';

export const metadata = { title: 'Cancelled receipts' };

const LIMIT = 300;

export default async function CancelledReceiptsPage({ searchParams }: { searchParams: Promise<{ unseen?: string }> }) {
  const user = await requireUser('orders');
  const owner = can(user, 'admin');
  const unseen = !!(await searchParams).unseen;
  const rows = await voidedReceipts({ unseen, take: LIMIT });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const notSeen = rows.filter((r) => !r.seenAt).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cancelled receipts"
        subtitle={`${rows.length}${rows.length === LIMIT ? '+' : ''} voided receipt${rows.length === 1 ? '' : 's'} · ${peso(total)}${notSeen ? ` · ${notSeen} not yet seen by the owner` : ''}`}
        actions={<>
          <Link href={unseen ? '/orders/cancelled-receipts' : '/orders/cancelled-receipts?unseen=1'} className="btn-secondary">{unseen ? 'Show all' : 'Not yet seen only'}</Link>
          {owner && notSeen > 0 && (
            <ActionForm action={markAllVoidsSeen} confirm={`Mark all ${notSeen} as seen?`}><SubmitButton className="btn-primary">Mark all seen</SubmitButton></ActionForm>
          )}
        </>}
      />
      <Card>
        {rows.length === 0 ? <Empty>{unseen ? 'No new cancelled receipts.' : 'No cancelled receipts.'}</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Receipt no.</th><th>Customer / order</th><th>Received</th><th>Voided</th><th>Reason</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className={r.seenAt ? '' : 'bg-red-50/60'}>
                    <td className="whitespace-nowrap">
                      <Link href={r.kind === 'payment' ? `/print/receipt/${r.id}` : `/print/advance/${r.id}`} className="link font-mono">{r.receiptNo}</Link>
                      {r.kind === 'deposit' && <div><Badge tone="amber">Advance payment</Badge></div>}
                    </td>
                    <td>
                      <Link href={`/customers/${r.customerId}`} className="link">{r.customer}</Link>
                      {r.order && <div className="text-xs"><Link href={`/orders/${r.order.id}`} className="font-mono hover:underline">{r.order.orderNo}</Link></div>}
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-600">{fmtDateTime(r.receivedAt)}<div>{PAYMENT_METHOD[r.method as keyof typeof PAYMENT_METHOD] ?? r.method} · by {r.receivedBy}</div></td>
                    <td className="whitespace-nowrap text-xs text-slate-600">{fmtDateTime(r.voidedAt)}<div>{r.voidedBy ? `by ${r.voidedBy}` : ''}{r.approvedBy ? ` · approved by ${r.approvedBy}` : ''}</div></td>
                    <td className="min-w-[12rem] text-xs text-slate-700">{r.reason ?? '—'}</td>
                    <td className="whitespace-nowrap text-right font-medium">{peso(r.amount)}</td>
                    <td className="whitespace-nowrap text-right text-xs">
                      {r.seenAt ? <span className="text-slate-500">Seen {fmtDateTime(r.seenAt)}{r.seenBy ? ` · ${r.seenBy}` : ''}</span>
                        : owner ? <ActionForm action={markVoidSeen.bind(null, r.kind, r.id)}><SubmitButton className="btn-secondary btn-sm">Seen</SubmitButton></ActionForm>
                        : <span className="font-semibold text-red-700">Not yet seen</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
