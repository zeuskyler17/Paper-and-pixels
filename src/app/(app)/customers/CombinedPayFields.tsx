'use client';

import { useState } from 'react';
import { peso, toCentavos } from '@/lib/money';
import { allocate } from '@/lib/combined';

type Row = { id: number; orderNo: string; date: string; total: number; balance: number };

/**
 * Amount + order checkboxes for a combined payment, with a live preview of the split:
 * the money goes to the ticked orders, oldest first, until it runs out.
 */
export function CombinedPayFields({ orders }: { orders: Row[] }) {
  const [amount, setAmount] = useState('');
  const [picked, setPicked] = useState<Set<number>>(() => new Set(orders.map((o) => o.id)));
  const chosen = orders.filter((o) => picked.has(o.id));
  const owed = chosen.reduce((s, o) => s + o.balance, 0);
  const cents = toCentavos(amount);
  const value = Number.isFinite(cents) && cents > 0 ? cents : 0;
  const shares = new Map(allocate(chosen, value).map((s) => [s.order.id, s]));
  const over = value > owed;
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8"><span className="sr-only">Include</span></th>
              <th>Order</th><th>Date</th>
              <th className="text-right">Balance</th>
              <th className="text-right">This payment</th>
              <th className="text-right">Balance after</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const s = shares.get(o.id);
              const on = picked.has(o.id);
              return (
                <tr key={o.id} className={on ? '' : 'opacity-50'}>
                  <td><input type="checkbox" name="orderId" value={o.id} checked={on} onChange={() => toggle(o.id)} aria-label={`Include ${o.orderNo}`} className="h-4 w-4 accent-[#1452d9]" /></td>
                  <td className="whitespace-nowrap font-mono">{o.orderNo}</td>
                  <td className="whitespace-nowrap">{o.date}</td>
                  <td className="text-right whitespace-nowrap text-red-600">{peso(o.balance)}</td>
                  <td className="text-right whitespace-nowrap font-semibold text-emerald-700">{s ? peso(s.share) : '—'}</td>
                  <td className="text-right whitespace-nowrap">{on ? peso(s ? s.after : o.balance) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td /><td colSpan={2} className="font-semibold">Combined ({chosen.length} order{chosen.length === 1 ? '' : 's'})</td>
              <td className="text-right font-semibold text-red-600">{peso(owed)}</td>
              <td className="text-right font-semibold text-emerald-700">{value ? peso(Math.min(value, owed)) : '—'}</td>
              <td className="text-right font-semibold">{peso(Math.max(0, owed - value))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">Amount received (₱) *</span>
          <input name="amount" className="input w-44" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <button type="button" className="btn-secondary h-9" onClick={() => setAmount((owed / 100).toFixed(2))} disabled={!owed}>Pay full {peso(owed)}</button>
      </div>
      {over && <p className="text-[13px] font-medium text-red-700">That is {peso(value - owed)} more than the ticked orders owe. Lower the amount, tick more orders, or record the extra as an advance payment.</p>}
      <p className="text-xs text-slate-500">The money goes to the ticked orders oldest first. Each order gets its own share on its payment list (receipt AR-…-1, -2…); the order&apos;s items and total stay the same.</p>
    </div>
  );
}
