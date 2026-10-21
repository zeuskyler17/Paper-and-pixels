'use client';

import { useState } from 'react';
import { isOtherCategory } from './_other';

/** Category select; when "Others" is chosen, a required box asks what the expense is. */
export function CategoryField({ categories }: { categories: { id: number; name: string }[] }) {
  const [id, setId] = useState('');
  const chosen = categories.find((c) => String(c.id) === id);
  const other = isOtherCategory(chosen?.name);
  return (
    <>
      <label className="block">
        <span className="label">Category *</span>
        <select name="categoryId" required className="input" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Choose…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {other && (
        <label className="block sm:col-span-2">
          <span className="label">Specify — what is this expense? *</span>
          <input name="otherDetail" required maxLength={120} autoFocus className="input" placeholder="e.g. Pambili ng tubig, parking fee, printer repair" />
        </label>
      )}
    </>
  );
}
