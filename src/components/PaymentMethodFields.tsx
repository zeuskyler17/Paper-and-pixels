'use client';

import { useState } from 'react';
import { PAYMENT_METHOD } from '@/lib/labels';

export type AccountOption = { id: number; method: string; label: string; accountNumber: string | null };

/**
 * Payment method + "Received in" (which of the shop's GCash / Maya / bank accounts got the money).
 * The account list follows the chosen method; cash has no account. Form field names: method, accountId.
 */
export function PaymentMethodFields({ accounts, defaultMethod = 'CASH', methodName = 'method', accountName = 'accountId', onChange }: {
  accounts: AccountOption[];
  defaultMethod?: string;
  methodName?: string;
  accountName?: string;
  /** Controlled use (e.g. POS): called with the current method and account. */
  onChange?: (method: string, accountId: number | null) => void;
}) {
  const [method, setMethod] = useState(defaultMethod);
  const [accountId, setAccountId] = useState<number | ''>('');
  const choices = accounts.filter((a) => a.method === method);

  return (
    <>
      <label className="block">
        <span className="label">Method *</span>
        <select name={methodName} className="input" value={method}
          onChange={(e) => { setMethod(e.target.value); setAccountId(''); onChange?.(e.target.value, null); }}>
          {Object.entries(PAYMENT_METHOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {method !== 'CASH' && choices.length > 0 && (
        <label className="block">
          <span className="label">Received in *</span>
          <select name={accountName} className="input" required value={accountId}
            onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ''; setAccountId(v); onChange?.(method, v || null); }}>
            <option value="">— which {PAYMENT_METHOD[method]} account? —</option>
            {choices.map((a) => <option key={a.id} value={a.id}>{a.label}{a.accountNumber ? ` · ${a.accountNumber}` : ''}</option>)}
          </select>
        </label>
      )}
    </>
  );
}
