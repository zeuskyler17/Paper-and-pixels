'use client';

import { useState } from 'react';
import { peso } from '@/lib/money';

export type SpecialProduct = {
  id: number; name: string; basePrice: number; category: string;
  /** The product's "Leaves" option values, when it has one (lay flat / cute albums). */
  leaves: { id: number; label: string; priceDelta: number }[];
};

/**
 * Rows of the "add special discounts" form: product · leaves (optional) · less per item.
 * Several products can be added in one save. Field names are productId_N, optionValueId_N, value_N.
 */
export function SpecialPriceRows({ products }: { products: SpecialProduct[] }) {
  const [rows, setRows] = useState<{ key: number; productId: string }[]>([{ key: 1, productId: '' }]);
  const byId = new Map(products.map((p) => [p.id, p]));
  // Dropdown grouped by category (Wedding Albums, Picture Frames, Photo Printing…), in the price list's order.
  const groups: [string, SpecialProduct[]][] = [];
  for (const p of products) { const g = groups.find(([c]) => c === p.category); if (g) g[1].push(p); else groups.push([p.category, [p]]); }
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const p = r.productId ? byId.get(Number(r.productId)) : undefined;
        return (
          <div key={r.key} className="flex flex-wrap items-end gap-2">
            <label className="block min-w-[14rem] flex-1"><span className="label">Product</span>
              <select name={`productId_${i}`} className="input" value={r.productId} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, productId: e.target.value } : x)))}>
                <option value="">— choose product —</option>
                {groups.map(([cat, list]) => (
                  <optgroup key={cat} label={cat}>
                    {list.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}{pr.basePrice > 0 ? ` — ${peso(pr.basePrice)}` : ''}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            {p && p.leaves.length > 0 && (
              <label className="block min-w-[11rem]"><span className="label">Leaves</span>
                <select name={`optionValueId_${i}`} className="input" defaultValue="">
                  <option value="">Any leaves</option>
                  {p.leaves.map((v) => <option key={v.id} value={v.id}>{v.label} leaves{v.priceDelta ? ` — ${peso(v.priceDelta)}` : ''}</option>)}
                </select>
              </label>
            )}
            <label className="block"><span className="label">Less per item (₱)</span>
              <input name={`value_${i}`} inputMode="decimal" placeholder="e.g. 200" className="input w-28 num" />
            </label>
            {rows.length > 1 && (
              <button type="button" className="btn-secondary px-3" aria-label="Remove row" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>×</button>
            )}
          </div>
        );
      })}
      <button type="button" className="btn-secondary btn-sm" onClick={() => setRows((rs) => [...rs, { key: Date.now(), productId: '' }])}>+ Add another product</button>
    </div>
  );
}
