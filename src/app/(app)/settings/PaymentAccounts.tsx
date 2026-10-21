import { prisma } from '@/lib/db';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Field, Select } from '@/components/ui';
import { PAYMENT_METHOD } from '@/lib/labels';
import { ACCOUNT_METHODS } from '@/lib/paymentAccounts';
import { createPaymentAccount, updatePaymentAccount } from './account-actions';

const methodOptions = ACCOUNT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD[m] }));

/** Settings card: the shop's GCash / Maya / bank accounts that receive customer payments. */
export async function PaymentAccounts() {
  const accounts = await prisma.paymentAccount.findMany({
    orderBy: [{ active: 'desc' }, { method: 'asc' }, { label: 'asc' }],
    include: { _count: { select: { payments: true } } },
  });
  return (
    <Card title="Payment accounts (GCash / Maya / bank)">
      <p className="mb-3 text-[13px] text-slate-600">
        The accounts customers send money to. When a payment is made by GCash, Maya or bank transfer, the cashier picks which account
        received it — shown on receipts and in <b>Reports → Payments collected by method</b>. Hide an account instead of deleting it.
      </p>
      {accounts.length > 0 && (
        <div className="mb-4 space-y-2">
          {accounts.map((a) => (
            <details key={a.id} className={`rounded border border-slate-200 ${a.active ? 'bg-white' : 'bg-slate-50 opacity-70'}`}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                <span className="font-semibold">{a.label}</span>
                <span className="text-slate-500">{PAYMENT_METHOD[a.method]}{a.accountNumber ? ` · ${a.accountNumber}` : ''}{a.accountName ? ` · ${a.accountName}` : ''}</span>
                <span className="ml-auto text-[11px] text-slate-400">{a._count.payments} payment{a._count.payments === 1 ? '' : 's'}{a.active ? '' : ' · hidden'}</span>
              </summary>
              <ActionForm action={updatePaymentAccount.bind(null, a.id)} className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2">
                <Field label="Type"><Select name="method" defaultValue={a.method} options={methodOptions} /></Field>
                <Field label="Short name *"><input name="label" defaultValue={a.label} className="input" required /></Field>
                <Field label="Account name"><input name="accountName" defaultValue={a.accountName ?? ''} className="input" /></Field>
                <Field label="Number"><input name="accountNumber" defaultValue={a.accountNumber ?? ''} className="input" /></Field>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="active" defaultChecked={a.active} /> Active (shown at the counter)</label>
                <div className="sm:text-right"><SubmitButton className="btn-secondary">Save</SubmitButton></div>
              </ActionForm>
            </details>
          ))}
        </div>
      )}
      <ActionForm action={createPaymentAccount} resetOnSuccess className="grid gap-3 rounded border border-dashed border-slate-300 p-3 sm:grid-cols-2">
        <Field label="Type *"><Select name="method" defaultValue="GCASH" options={methodOptions} /></Field>
        <Field label="Short name *"><input name="label" className="input" placeholder={'e.g. Jc\'s GCash, BDO Savings'} required /></Field>
        <Field label="Account name"><input name="accountName" className="input" placeholder="Name on the account" /></Field>
        <Field label="Number"><input name="accountNumber" className="input" placeholder="0917 555 0101 / account no." /></Field>
        <div className="sm:col-span-2"><SubmitButton>+ Add account</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}
