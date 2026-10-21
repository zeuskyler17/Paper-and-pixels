'use client';

import { useEffect, useRef, useState } from 'react';

export type CopySource = { id: number; name: string; categoryId: number; categoryName: string; options: number; bom: number };

/**
 * "Copy options & add-on prices from" picker. On the new-product form it follows the chosen category:
 * picking e.g. Wedding Album pre-selects that category's first product that has options.
 */
export function CopyOptionsField({ sources, followCategory = false, initialCategoryId }: { sources: CopySource[]; followCategory?: boolean; initialCategoryId?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const firstFor = (cat?: number) => (cat ? sources.find((s) => s.categoryId === cat && s.options > 0)?.id : undefined);
  const [cat, setCat] = useState<number | undefined>(initialCategoryId);
  const [value, setValue] = useState(String(firstFor(initialCategoryId) ?? ''));

  useEffect(() => {
    if (!followCategory) return;
    const sel = ref.current?.closest('form')?.querySelector<HTMLSelectElement>('select[name="categoryId"]');
    if (!sel) return;
    const on = () => { const c = Number(sel.value) || undefined; setCat(c); setValue(String(firstFor(c) ?? '')); };
    sel.addEventListener('change', on);
    return () => sel.removeEventListener('change', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followCategory]);

  const chosen = sources.find((s) => String(s.id) === value);
  const same = sources.filter((s) => s.categoryId === cat);
  const others = sources.filter((s) => s.categoryId !== cat);
  const label = (s: CopySource) => `${s.name} — ${s.options} option${s.options === 1 ? '' : 's'}`;

  return (
    <div ref={ref} className="rounded border border-slate-200 bg-slate-50 p-3">
      <label className="block">
        <span className="label">Copy options &amp; add-on prices from</span>
        <select name="copyFromId" value={value} onChange={(e) => setValue(e.target.value)} className="input">
          <option value="">— Don’t copy —</option>
          {same.length > 0 && <optgroup label={`Same category${same[0] ? ` (${same[0].categoryName})` : ''}`}>{same.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</optgroup>}
          {others.length > 0 && <optgroup label="Other products">{others.map((s) => <option key={s.id} value={s.id}>{s.categoryName}: {label(s)}</option>)}</optgroup>}
        </select>
      </label>
      {chosen && (
        <div className="mt-2 space-y-1.5 text-[12px] text-slate-600">
          <p>All {chosen.options} option(s) of <b>{chosen.name}</b> — cover types, sizes, leaves, add-ons — are copied with their prices. You can change any price after saving.</p>
          {chosen.bom > 0 && (
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input key={chosen.id} type="checkbox" name="copyBom" defaultChecked /> Also copy the materials used ({chosen.bom} bill-of-materials line{chosen.bom === 1 ? '' : 's'})
            </label>
          )}
        </div>
      )}
    </div>
  );
}
