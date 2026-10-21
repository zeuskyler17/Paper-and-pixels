'use client';

import { useRef, useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { fmtQty } from '@/lib/money';
import { MATERIAL_LEVEL } from '@/lib/labels';
import { stockOutQuick } from '../actions';

type Mat = { id: number; name: string; unit: string; stock: number; reorderLevel: number; level: string };

export function StockOutForm({ materials, workers, defaultMaterialId, levels: levelList }: {
  materials: Mat[]; workers: { id: number; name: string }[]; defaultMaterialId?: number; levels?: string[];
}) {
  const [materialId, setMaterialId] = useState<number | ''>(defaultMaterialId ?? '');
  const [q, setQ] = useState('');
  const mat = materials.find((m) => m.id === materialId);
  const shown = q ? materials.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()) || m.id === materialId) : materials;
  const levels = levelList ?? ['RAW_RAW', 'RAW', 'CONSUMABLE', 'GENERAL'];
  const qtyRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);
  // After a successful out keep the material & worker selected; clear only qty and notes.
  const clear = () => { if (qtyRef.current) qtyRef.current.value = ''; if (notesRef.current) notesRef.current.value = ''; };

  return (
    <ActionForm action={stockOutQuick} onSuccess={clear} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Material *</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search material…" className="input sm:w-56" />
            <select name="materialId" required className="input" value={materialId}
              onChange={(e) => setMaterialId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— choose material —</option>
              {levels.map((lv) => {
                const group = shown.filter((m) => m.level === lv);
                return group.length === 0 ? null : (
                  <optgroup key={lv} label={MATERIAL_LEVEL[lv]}>
                    {group.map((m) => <option key={m.id} value={m.id}>{m.name} — {fmtQty(m.stock)} {m.unit} on hand</option>)}
                  </optgroup>
                );
              })}
            </select>
          </div>
        </label>

        {mat && (
          <div className={`sm:col-span-2 rounded-md px-3 py-2 text-sm ${mat.stock <= 0 ? 'bg-red-50 text-red-700' : mat.stock <= mat.reorderLevel ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-700'}`}>
            On hand: <strong>{fmtQty(mat.stock)} {mat.unit}</strong>
            {mat.stock <= mat.reorderLevel && ` · low stock (reorder at ${fmtQty(mat.reorderLevel)} ${mat.unit})`}
          </div>
        )}

        <label className="block">
          <span className="label">Quantity out *{mat ? ` (${mat.unit})` : ''}</span>
          <input ref={qtyRef} name="qty" type="number" step="any" min="0.001" max={mat ? Math.max(mat.stock, 0) : undefined} required inputMode="decimal" className="input" />
        </label>
        <label className="block">
          <span className="label">Released to (worker)</span>
          <select name="releasedToId" className="input" defaultValue="">
            <option value="">— not released to a worker —</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Notes / purpose</span>
          <input ref={notesRef} name="notes" className="input" placeholder="e.g. for PP-2026-00012 album covers · or: damaged, sample" />
          <span className="mt-1 block text-xs text-slate-500">Required when not released to a worker.</span>
        </label>
      </div>
      <SubmitButton>Take out of stock</SubmitButton>
    </ActionForm>
  );
}
