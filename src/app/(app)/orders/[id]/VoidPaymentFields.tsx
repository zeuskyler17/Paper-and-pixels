'use client';

import { useState } from 'react';
import { peso } from '@/lib/money';

export type VoidItem = { id: number; label: string; amount: number };

/**
 * What to void on one receipt: the whole receipt, the part paid for one order item, or any amount.
 * A partial void keeps the receipt with the rest of the money; the voided part becomes its own
 * (voided) row, e.g. AR-2026-00065-V1.
 */
export function VoidPaymentFields({ paymentAmount, items }: { paymentAmount: number; items: VoidItem[] }) {
  const [scope, setScope] = useState('all');
  const [amount, setAmount] = useState((paymentAmount / 100).toFixed(2));
  const pick = (v: string) => {
    setScope(v);
    if (v === 'all') setAmount((paymentAmount / 100).toFixed(2));
    else if (v.startsWith('item:')) {
      const it = items.find((i) => String(i.id) === v.slice(5));
      if (it) setAmount((Math.min(it.amount, paymentAmount) / 100).toFixed(2));
    }
  };
  return (
    <>
      <label className="block"><span className="label">Void</span>
        <select name="scope" className="input" value={scope} onChange={(e) => pick(e.target.value)}>
          <option value="all">Whole receipt — {peso(paymentAmount)}</option>
          {items.map((i) => <option key={i.id} value={`item:${i.id}`}>Item: {i.label} — {peso(Math.min(i.amount, paymentAmount))} (takes the item off the order)</option>)}
          <option value="amount">Other amount…</option>
        </select>
      </label>
      {scope !== 'all' && (
        <label className="block"><span className="label">Amount to void (₱)</span>
          <input name="amount" inputMode="decimal" className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
      )}
    </>
  );
}
