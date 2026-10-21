'use client';

import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, TableWrap } from '@/components/ui';
import type { ActionState } from '@/lib/action';

export type CleanupRow = {
  id: number; name: string; level: string; usedFor: string; stock: string; active: boolean;
  products: string[]; movements: number; realMovements: number; blocked: string | null;
};

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function CleanupForm({ rows, onDelete, onDeactivate }: { rows: CleanupRow[]; onDelete: Action; onDeactivate: Action }) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pick = (f: (r: CleanupRow) => boolean) => setSel(new Set(rows.filter(f).map((r) => r.id)));
  const chosen = rows.filter((r) => sel.has(r.id));
  const deletable = chosen.filter((r) => !r.blocked);
  const Hidden = () => <>{[...sel].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}</>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className="mr-1 font-semibold uppercase tracking-[0.07em] text-slate-500">Quick select</span>
        <button type="button" className="btn-secondary btn-sm" onClick={() => pick((r) => r.products.length === 0)}>Not used by any product</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => pick((r) => r.realMovements === 0)}>No real stock activity</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => pick(() => true)}>All</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setSel(new Set())}>None</button>
        <span className="ml-auto font-semibold text-slate-700">{sel.size} selected</span>
      </div>

      <TableWrap>
        <table className="table">
          <thead>
            <tr><th className="w-8" /><th>Material</th><th>Used for</th><th className="text-right">Stock</th><th>Products using it</th><th className="text-right">History rows</th><th>If deleted</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`${sel.has(r.id) ? 'bg-brand-50/60' : ''} ${r.active ? '' : 'text-slate-400'}`} onClick={() => toggle(r.id)} style={{ cursor: 'pointer' }}>
                <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${r.name}`} /></td>
                <td className="font-semibold">{r.name}{!r.active && <span className="ml-1 text-[10px] font-semibold uppercase text-slate-400">inactive</span>}<div className="text-[11px] font-normal text-slate-500">{r.level}</div></td>
                <td className="whitespace-nowrap text-[12.5px]">{r.usedFor}</td>
                <td className="text-right font-mono">{r.stock}</td>
                <td className="max-w-xs text-[12px] text-slate-600">{r.products.length ? r.products.join(', ') : <span className="text-slate-400">none</span>}</td>
                <td className="text-right font-mono text-[12.5px]">{r.movements}{r.realMovements > 0 && <div className="text-[10.5px] text-amber-700">{r.realMovements} after setup</div>}</td>
                <td className="text-[12px]">
                  {r.blocked ? <Badge tone="red">Cannot delete</Badge> : r.movements || r.products.length ? <Badge tone="amber">Removes history</Badge> : <Badge tone="green">Clean</Badge>}
                  {r.blocked && <div className="mt-0.5 text-slate-500">{r.blocked}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-red-200 bg-red-50/40 p-3">
          <div className="text-[13px] font-semibold text-red-800">Delete permanently</div>
          <p className="mb-2 text-[12px] text-slate-600">Removes the material, its stock history and its lines in product bills of materials. Use for sample / never-used stock. Cannot be undone (a backup is kept under Settings → Backups).</p>
          <ActionForm action={onDelete} confirm={`Permanently delete ${deletable.length} material(s) and their stock history? This cannot be undone.`}>
            <Hidden />
            <SubmitButton className="btn-danger btn-sm">Delete {deletable.length || ''} selected</SubmitButton>
            {chosen.length > deletable.length && <span className="ml-2 text-[12px] text-red-700">{chosen.length - deletable.length} selected cannot be deleted and will be skipped — deactivate those instead.</span>}
          </ActionForm>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <div className="text-[13px] font-semibold text-slate-800">Deactivate (hide)</div>
          <p className="mb-2 text-[12px] text-slate-600">Keeps all history; the material just disappears from lists and pickers. Safe for anything you once used.</p>
          <ActionForm action={onDeactivate}>
            <Hidden />
            <SubmitButton className="btn-secondary btn-sm">Deactivate {chosen.filter((r) => r.active).length || ''} selected</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
