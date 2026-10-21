'use client';

import { useState } from 'react';
import { centavosToInput, toCentavosOrZero } from '@/lib/money';

/** Discount amount input with a % helper that converts a percentage of the subtotal to pesos. */
export function DiscountFields({ subtotal, discount, reason, approvedBy }: { subtotal: number; discount: number; reason: string | null; approvedBy?: string | null }) {
  const [amount, setAmount] = useState(discount ? centavosToInput(discount) : '');
  const [why, setWhy] = useState(reason ?? '');
  const [pct, setPct] = useState('');
  const newDiscount = toCentavosOrZero(amount);
  // Adding or changing a discount needs the owner/admin password (removing one does not).
  const needsApproval = Number.isFinite(newDiscount) && newDiscount > 0 && newDiscount !== discount;

  function apply() {
    const n = Number(pct);
    if (!(n > 0) || n > 100) return;
    setAmount(centavosToInput(Math.round((subtotal * n) / 100)));
    if (!why) setWhy(`${n}% discount`);
  }

  return (
    <>
      <div className="sm:col-span-2">
        <span className="label">Discount (₱)</span>
        <div className="flex gap-2">
          <input name="discount" className="input min-w-0 flex-1" inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
          <input className="input w-20" inputMode="decimal" value={pct} placeholder="%" aria-label="Discount percent" onChange={(e) => setPct(e.target.value)} />
          <button type="button" className="btn-secondary whitespace-nowrap" onClick={apply}>Apply %</button>
        </div>
      </div>
      <label className="block sm:col-span-2">
        <span className="label">Discount reason</span>
        <input name="discountReason" className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Required when there is a discount" />
      </label>
      {needsApproval ? (
        <label className="block sm:col-span-2">
          <span className="label">Owner approval PIN *</span>
          <input name="discountPin" type="password" inputMode="numeric" pattern="\d{4,8}" maxLength={8} autoComplete="off" required className="input" placeholder="Owner enters their PIN to approve the discount" />
        </label>
      ) : discount > 0 && approvedBy ? (
        <p className="text-xs text-slate-500 sm:col-span-2">Current discount approved by {approvedBy}.</p>
      ) : null}
    </>
  );
}
