'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { centavosToInput, fmtQty, peso, toCentavos } from '@/lib/money';
import { createPurchaseOrder, updatePurchaseOrder, type POPayload } from './actions';

export type POMaterial = { id: number; name: string; unit: string; unitCost: number; supplierId: number | null; sku: string | null; stock: number };
type Line = { key: number; materialId: string; quantity: string; unitCost: string };

export type POInitial = {
  supplierId: number | null;
  orderDate: string;
  expectedDate: string;
  notes: string;
  items: { materialId: number; quantity: number; unitCost: number }[];
};

let seq = 0;
const blank = (): Line => ({ key: ++seq, materialId: '', quantity: '', unitCost: '' });

export function POForm({ poId, suppliers, materials, initial }: {
  poId?: number;
  suppliers: { id: number; name: string }[];
  materials: POMaterial[];
  initial: POInitial;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState(initial.supplierId ? String(initial.supplierId) : '');
  const [orderDate, setOrderDate] = useState(initial.orderDate);
  const [expectedDate, setExpectedDate] = useState(initial.expectedDate);
  const [notes, setNotes] = useState(initial.notes);
  const [lines, setLines] = useState<Line[]>(() =>
    initial.items.length
      ? initial.items.map((i) => ({ key: ++seq, materialId: String(i.materialId), quantity: String(i.quantity), unitCost: centavosToInput(i.unitCost) }))
      : [blank()],
  );
  const [onlySupplier, setOnlySupplier] = useState(true);

  const matById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const supplierMats = materials.filter((m) => m.supplierId === Number(supplierId));
  const pickable = onlySupplier && supplierId && supplierMats.length > 0 ? supplierMats : materials;

  const lineTotal = (l: Line) => {
    const q = Number(l.quantity);
    const c = toCentavos(l.unitCost);
    return Number.isFinite(q) && Number.isFinite(c) ? Math.round(q * c) : 0;
  };
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickMaterial = (key: number, materialId: string) => {
    const m = matById.get(Number(materialId));
    update(key, { materialId, unitCost: m ? centavosToInput(m.unitCost) : '' });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: POPayload = {
      supplierId: Number(supplierId),
      orderDate,
      expectedDate,
      notes,
      items: lines.filter((l) => l.materialId || l.quantity).map((l) => ({ materialId: Number(l.materialId), quantity: l.quantity, unitCost: l.unitCost })),
    };
    startTransition(async () => {
      const res = poId ? await updatePurchaseOrder(poId, payload) : await createPurchaseOrder(payload);
      if (res.error) { setError(res.error); return; }
      router.push(`/purchase-orders/${res.id}`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Supplier *</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required className="input">
              <option value="">— choose —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Order date</span>
              <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="input" />
            </label>
            <label className="block">
              <span className="label">Expected date</span>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="input" />
            </label>
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="label mb-0">Items</span>
            {supplierId && supplierMats.length > 0 && (
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={onlySupplier} onChange={(e) => setOnlySupplier(e.target.checked)} />
                Only this supplier&apos;s materials
              </label>
            )}
          </div>
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_7rem_8rem_8rem_2rem] gap-2 px-1 text-xs font-semibold uppercase text-slate-500 sm:grid">
              <span>Material</span><span>Qty</span><span>Unit cost (₱)</span><span className="text-right">Line total</span><span />
            </div>
            {lines.map((l, idx) => {
              const m = matById.get(Number(l.materialId));
              const opts = m && !pickable.includes(m) ? [m, ...pickable] : pickable;
              return (
                <div key={l.key} className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr_7rem_8rem_8rem_2rem] sm:border-0 sm:p-0">
                  <div className="col-span-2 sm:col-span-1">
                    <select value={l.materialId} onChange={(e) => pickMaterial(l.key, e.target.value)} className="input" aria-label={`Line ${idx + 1} material`}>
                      <option value="">— material —</option>
                      {opts.map((o) => <option key={o.id} value={o.id}>{o.name}{o.sku ? ` (${o.sku})` : ''} · {o.unit}</option>)}
                    </select>
                    {m && <span className="mt-0.5 block text-xs text-slate-500">In stock: {fmtQty(m.stock)} {m.unit}</span>}
                  </div>
                  <input type="number" step="0.001" min="0.001" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })}
                    placeholder={m ? `Qty (${m.unit})` : 'Qty'} className="input" aria-label={`Line ${idx + 1} quantity`} />
                  <input inputMode="decimal" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })}
                    placeholder="Unit cost" className="input" aria-label={`Line ${idx + 1} unit cost`} />
                  <div className="flex items-center text-sm font-medium sm:justify-end">{peso(lineTotal(l))}</div>
                  <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))}
                    className="btn-secondary btn-sm justify-self-end" title="Remove line">✕</button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className="btn-secondary btn-sm">+ Add item</button>
            <div className="text-base font-bold">Total: {peso(total)}</div>
          </div>
        </div>

        <label className="block">
          <span className="label">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" placeholder="Delivery instructions, terms…" />
        </label>
      </fieldset>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? 'Saving…' : poId ? 'Save changes' : 'Create purchase order'}</button>
      </div>
    </form>
  );
}
