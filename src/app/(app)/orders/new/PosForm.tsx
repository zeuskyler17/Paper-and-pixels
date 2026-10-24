'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { applySpecialPrice, computeUnitPrice, type Selection } from '@/lib/pricing';
import { centavosToInput, peso, toCentavos, toCentavosOrZero } from '@/lib/money';
import { FILE_SOURCE, PAYMENT_METHOD, PAYMENT_TERMS, options } from '@/lib/labels';
import type { CreateOrderInput, PosCustomer, PosProduct } from '../_lib';
import type { AccountOption } from '@/components/PaymentMethodFields';
import { createOrder, quickCreateCustomer, searchCustomers } from '../actions';

type Line = {
  key: number;
  productId: number | null;
  selection: Record<number, number | number[] | null>;
  widthFt: string;
  heightFt: string;
  quantity: string;
  priceInput: string; // '' = use suggested price
  overrideReason: string;
  specsNotes: string;
  fileSource: string;
  fileSourceNote: string;
};

let lineSeq = 1;
function newLine(): Line {
  return {
    key: lineSeq++, productId: null, selection: {}, widthFt: '', heightFt: '', quantity: '1',
    priceInput: '', overrideReason: '', specsNotes: '', fileSource: 'NONE', fileSourceNote: '',
  };
}

function defaultSelection(p: PosProduct): Line['selection'] {
  const s: Line['selection'] = {};
  for (const o of p.options) {
    if (o.type === 'NUMBER' && o.defaultValue != null) s[o.id] = o.defaultValue;
    if (o.type === 'MULTI') s[o.id] = [];
  }
  return s;
}

export function PosForm({ products, initialCustomer, today, accounts = [], points: pointsCfg = { enabled: false, value: 0, weekCap: 0 } }: { products: PosProduct[]; initialCustomer: PosCustomer | null; today: string; accounts?: AccountOption[]; points?: { enabled: boolean; value: number; weekCap: number } }) {
  const router = useRouter();
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const groups = useMemo(() => {
    const g = new Map<string, PosProduct[]>();
    for (const p of products) g.set(p.categoryName, [...(g.get(p.categoryName) ?? []), p]);
    return [...g.entries()];
  }, [products]);

  // ── customer
  const [customer, setCustomer] = useState<PosCustomer | null>(initialCustomer);

  // ── items
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // ── order details & payment
  const [targetDate, setTargetDate] = useState('');
  const [notes, setNotes] = useState('');
  const [discountInput, setDiscountInput] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountPin, setDiscountPin] = useState('');
  // true while the discount was filled in from the customer's special discount (re-computed as items change)
  const [discountAuto, setDiscountAuto] = useState(false);
  const [pct, setPct] = useState('');
  const [pointsInput, setPointsInput] = useState('');
  const [terms, setTerms] = useState('DOWNPAYMENT');
  const [paidInput, setPaidInput] = useState('');
  const [method, setMethod] = useState('CASH');
  const [accountId, setAccountId] = useState<number | ''>('');
  const accountChoices = accounts.filter((a) => a.method === method);
  const [reference, setReference] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // ── live computation
  const specialBy = new Map((customer?.isInternal ? [] : customer?.specialPrices ?? []).map((sp) => [sp.productId, sp]));
  const computed = lines.map((l) => {
    const p = l.productId ? productMap.get(l.productId) : undefined;
    if (!p) return { product: undefined, suggested: 0, normal: 0, special: false, unit: 0, total: 0, errors: [] as string[], overridden: false, qty: 0 };
    const calc = computeUnitPrice(p, l.selection as Selection, p.pricingMode === 'PER_SQFT' ? Number(l.widthFt) : null, p.pricingMode === 'PER_SQFT' ? Number(l.heightFt) : null);
    // Customer's special price (owner-set) replaces the normal price.
    const specialUnit = applySpecialPrice(calc.unitPrice, specialBy.get(p.id));
    const res = { ...calc, unitPrice: specialUnit ?? calc.unitPrice };
    const override = l.priceInput.trim() === '' ? NaN : toCentavos(l.priceInput);
    const overridden = !customer?.isInternal && Number.isFinite(override) && override !== res.unitPrice;
    const unit = customer?.isInternal ? 0 : Number.isFinite(override) ? override : res.unitPrice;
    const qty = Number.parseInt(l.quantity, 10);
    const errors = [...res.errors];
    if (l.priceInput.trim() !== '' && !(override >= 0)) errors.push('Unit price is not a valid amount.');
    if (!(qty >= 1)) errors.push('Quantity must be at least 1.');
    return { product: p, suggested: res.unitPrice, normal: calc.unitPrice, special: specialUnit !== null, unit, total: unit * (qty >= 1 ? qty : 0), errors, overridden, qty };
  });
  const subtotal = computed.reduce((s, c) => s + c.total, 0);
  const discount = toCentavosOrZero(discountInput);
  // Customer's special discount (set by the owner): pre-approved, so no PIN needed up to this amount.
  const specialPct = !customer?.isInternal && customer?.specialDiscountPct ? customer.specialDiscountPct : 0;
  const specialAmount = specialPct ? Math.round((subtotal * specialPct) / 100) : 0;
  const needsPin = discount > 0 && discount > specialAmount;
  // Loyalty points used as pesos off (only when the promo is on and the customer has points).
  const canUsePoints = pointsCfg.enabled && !!customer && !customer.isInternal && (customer.points ?? 0) > 0 && pointsCfg.value > 0;
  const afterDiscount = subtotal - (Number.isFinite(discount) ? discount : 0);
  const maxPoints = canUsePoints ? Math.max(0, Math.min(customer!.points ?? 0, Math.floor(afterDiscount / pointsCfg.value), pointsCfg.weekCap > 0 ? pointsCfg.weekCap : Infinity)) : 0;
  const pointsUsed = canUsePoints ? Math.max(0, Math.floor(Number(pointsInput) || 0)) : 0;
  const pointsAmount = pointsUsed * pointsCfg.value;
  const total = afterDiscount - pointsAmount;
  const paid = terms === 'FULL' ? total : toCentavosOrZero(paidInput);
  const balance = total - (Number.isFinite(paid) ? paid : 0);

  useEffect(() => {
    if (specialPct) {
      if (discountAuto || discountInput.trim() === '') {
        setDiscountInput(specialAmount ? centavosToInput(specialAmount) : '');
        setDiscountReason(`Special customer discount (${specialPct}%)`);
        setDiscountAuto(true);
      }
    } else if (discountAuto) {
      setDiscountInput(''); setDiscountReason(''); setDiscountAuto(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialPct, specialAmount]);

  function applyPct() {
    setDiscountAuto(false);
    const n = Number(pct);
    if (!(n > 0) || n > 100) return;
    setDiscountInput(centavosToInput(Math.round((subtotal * n) / 100)));
    if (!discountReason) setDiscountReason(`${n}% discount`);
  }

  function onTerms(t: string) {
    setTerms(t);
    if (t === 'PAY_AFTER' || t === 'CREDIT') setPaidInput('');
  }

  function save() {
    setError(null);
    const problems: string[] = [];
    if (!customer) problems.push('Choose or create a customer.');
    const filled = lines.filter((l) => l.productId);
    if (filled.length === 0) problems.push('Add at least one item.');
    computed.forEach((c, i) => {
      if (!c.product) return;
      c.errors.forEach((e) => problems.push(`Item ${i + 1}: ${e}`));
      if (c.overridden && !lines[i].overrideReason.trim()) problems.push(`Item ${i + 1}: enter a reason for changing the price.`);
    });
    if (!Number.isFinite(discount) || discount < 0) problems.push('Discount is not a valid amount.');
    else if (discount > subtotal) problems.push('Discount cannot be more than the subtotal.');
    else if (discount > 0 && !discountReason.trim()) problems.push('Enter a reason for the discount.');
    else if (needsPin && !discountPin) problems.push(specialAmount ? `The discount is more than ${customer?.name}'s special ${specialPct}% (${peso(specialAmount)}): ask the owner to enter their approval PIN.` : 'Ask the owner to enter their approval PIN for the discount.');
    if (pointsUsed > maxPoints) problems.push(`Use at most ${maxPoints} point(s) on this order.`);
    if (paid > 0 && method !== 'CASH' && accountChoices.length > 0 && !accountId) problems.push(`Choose which ${PAYMENT_METHOD[method]} account received the payment.`);
    if (!Number.isFinite(paid) || paid < 0) problems.push('Amount paid is not a valid amount.');
    else if (paid > total) problems.push('Amount paid is more than the total.');
    else if (terms === 'DOWNPAYMENT' && paid <= 0 && total > 0) problems.push('Enter the downpayment amount.');
    if (problems.length) { setError(problems.join('\n')); return; }

    const payload: CreateOrderInput = {
      customerId: customer!.id,
      lines: lines.flatMap((l, i) => {
        const c = computed[i];
        if (!c.product) return [];
        const selection: Record<string, number | number[] | null> = {};
        for (const [k, v] of Object.entries(l.selection)) selection[k] = v ?? null;
        return [{
          productId: c.product.id,
          selection,
          widthFt: c.product.pricingMode === 'PER_SQFT' ? Number(l.widthFt) : null,
          heightFt: c.product.pricingMode === 'PER_SQFT' ? Number(l.heightFt) : null,
          quantity: c.qty,
          unitPrice: c.overridden ? c.unit : null,
          overrideReason: c.overridden ? l.overrideReason.trim() : '',
          specsNotes: l.specsNotes,
          fileSource: l.fileSource,
          fileSourceNote: l.fileSourceNote,
        }];
      }),
      targetDate,
      notes,
      discount: Number.isFinite(discount) ? discount : 0,
      discountReason,
      discountPin: needsPin ? discountPin : '',
      pointsUsed,
      paymentTerms: terms,
      amountPaid: paid,
      method,
      accountId: accountId || null,
      reference,
    };

    startSaving(async () => {
      const res = await createOrder(payload);
      if (res.error || !res.id) { setError(res.error ?? 'Could not save the order.'); return; }
      router.push(`/orders/${res.id}`);
    });
  }

  return (
    <div className="space-y-4 pb-24">
      {/* 1. Customer */}
      <section className="card p-4">
        <h2 className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-700"><span className="grid h-5 w-5 place-items-center rounded-[3px] bg-graphite-800 font-mono text-[10.5px] text-white">1</span>Customer</h2>
        <CustomerPicker customer={customer} onChange={setCustomer} />
        {customer?.isInternal && (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900"><b>Branch transfer.</b> {customer.name} is one of our branches: this order carries no prices, discount or payment — it only moves finished products to that branch. Production and delivery work as usual.</p>
        )}
      </section>

      {/* 2-3. Items */}
      <section className="card p-4">
        <h2 className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-700"><span className="grid h-5 w-5 place-items-center rounded-[3px] bg-graphite-800 font-mono text-[10.5px] text-white">2</span>Items</h2>
        <div className="space-y-4">
          {lines.map((l, i) => {
            const c = computed[i];
            const p = c.product;
            return (
              <div key={l.key} className="rounded-md border border-slate-200 p-3">
                <div className="mb-3 flex items-start gap-2">
                  <span className="mt-2 text-xs font-semibold text-slate-500">#{i + 1}</span>
                  <select
                    className="input flex-1"
                    value={l.productId ?? ''}
                    onChange={(e) => {
                      const id = Number(e.target.value) || null;
                      const np = id ? productMap.get(id) : undefined;
                      update(l.key, { productId: id, selection: np ? defaultSelection(np) : {}, priceInput: '', overrideReason: '', widthFt: '', heightFt: '' });
                    }}
                    aria-label="Product"
                  >
                    <option value="">— choose product —</option>
                    {groups.map(([cat, ps]) => (
                      <optgroup key={cat} label={cat}>
                        {ps.map((x) => <option key={x.id} value={x.id}>{x.name} — {peso(x.basePrice)}{x.pricingMode === 'PER_SQFT' ? '/sq ft' : ''}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  {lines.length > 1 && (
                    <button type="button" className="btn-secondary btn-sm mt-1 text-red-700" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      Remove
                    </button>
                  )}
                </div>

                {p && (
                  <div className="space-y-3">
                    {p.description && <p className="text-xs text-slate-500">{p.description}</p>}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {p.pricingMode === 'PER_SQFT' && (
                        <>
                          <label className="block"><span className="label">Width (ft) *</span>
                            <input className="input" inputMode="decimal" value={l.widthFt} onChange={(e) => update(l.key, { widthFt: e.target.value })} />
                          </label>
                          <label className="block"><span className="label">Height (ft) *</span>
                            <input className="input" inputMode="decimal" value={l.heightFt} onChange={(e) => update(l.key, { heightFt: e.target.value })} />
                          </label>
                        </>
                      )}
                      {p.options.map((o) => {
                        const sel = l.selection[o.id];
                        const setSel = (v: number | number[] | null) => update(l.key, { selection: { ...l.selection, [o.id]: v } });
                        if (o.type === 'SELECT') {
                          return (
                            <label key={o.id} className="block"><span className="label">{o.name}{o.required ? ' *' : ''}</span>
                              <select className="input" value={typeof sel === 'number' ? sel : ''} onChange={(e) => setSel(e.target.value ? Number(e.target.value) : null)}>
                                <option value="">{o.required ? '— choose —' : '— none —'}</option>
                                {o.values.map((v) => <option key={v.id} value={v.id}>{v.label}{v.priceDelta ? ` (${v.priceDelta > 0 ? '+' : '−'}${peso(Math.abs(v.priceDelta))})` : ''}</option>)}
                              </select>
                            </label>
                          );
                        }
                        if (o.type === 'MULTI') {
                          // Add-ons: one dropdown per add-on; "+" adds another, "×" removes one. The same add-on can't be picked twice.
                          const ids = Array.isArray(sel) ? sel : [];
                          const label = (v: (typeof o.values)[number]) => `${v.label}${v.priceDelta ? ` (${v.priceDelta > 0 ? '+' : '−'}${peso(Math.abs(v.priceDelta))})` : ''}`;
                          const rows = ids.length ? ids : [0];
                          const left = o.values.filter((v) => !ids.includes(v.id));
                          return (
                            <div key={o.id} className="block">
                              <span className="label">{o.name}{o.required ? ' *' : ''}</span>
                              <div className="space-y-1.5">
                                {rows.map((id, i) => (
                                  <div key={i} className="flex gap-1.5">
                                    <select className="input min-w-0 flex-1" value={id || ''}
                                      onChange={(e) => {
                                        const v = Number(e.target.value) || 0;
                                        const next = [...rows]; next[i] = v;
                                        setSel(next.filter((x, j) => x > 0 && next.indexOf(x) === j));
                                      }}>
                                      <option value="">{o.required && i === 0 ? '— choose —' : '— none —'}</option>
                                      {o.values.filter((v) => v.id === id || !ids.includes(v.id)).map((v) => <option key={v.id} value={v.id}>{label(v)}</option>)}
                                    </select>
                                    {ids.length > 0 && id > 0 && (
                                      <button type="button" className="btn-secondary shrink-0 px-3" title={`Remove this ${o.name.toLowerCase()}`} aria-label="Remove"
                                        onClick={() => setSel(ids.filter((x) => x !== id))}>×</button>
                                    )}
                                  </div>
                                ))}
                                {ids.length > 0 && !ids.includes(0) && left.length > 0 && (
                                  <button type="button" className="btn-secondary px-3 text-[13px]" onClick={() => setSel([...ids, 0])}>+ Add another</button>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <label key={o.id} className="block">
                            <span className="label">{o.name}{o.required ? ' *' : ''} <span className="normal-case text-slate-400">({peso(o.unitPrice)} each)</span></span>
                            <input
                              className="input"
                              inputMode="numeric"
                              value={typeof sel === 'number' ? String(sel) : ''}
                              placeholder={[o.minValue != null ? `min ${o.minValue}` : '', o.maxValue != null ? `max ${o.maxValue}` : ''].filter(Boolean).join(', ')}
                              onChange={(e) => setSel(e.target.value.trim() === '' || !Number.isFinite(Number(e.target.value)) ? null : Number(e.target.value))}
                            />
                          </label>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <label className="block"><span className="label">Quantity *</span>
                        <input className="input" inputMode="numeric" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                      </label>
                      <label className="block"><span className="label">Unit price (₱)</span>
                        <input
                          className={`input ${c.overridden ? 'border-amber-400 bg-amber-50' : ''}`}
                          inputMode="decimal"
                          value={l.priceInput}
                          placeholder={centavosToInput(c.suggested)}
                          onChange={(e) => update(l.key, { priceInput: e.target.value })}
                        />
                      </label>
                      <div className="col-span-2 flex flex-col justify-end text-sm">
                        {c.special && <div className="font-medium text-emerald-700">Special discount for {customer?.name}: less {peso(c.normal - c.suggested)} each (normally {peso(c.normal)})</div>}
                        <div className="text-slate-500">Suggested: {peso(c.suggested)}{p.pricingMode === 'PER_SQFT' && Number(l.widthFt) > 0 && Number(l.heightFt) > 0 ? ` (${(Number(l.widthFt) * Number(l.heightFt)).toFixed(2)} sq ft)` : ''}</div>
                        <div className="text-base font-semibold">Line total: {peso(c.total)}</div>
                      </div>
                    </div>
                    {c.overridden && (
                      <label className="block"><span className="label text-amber-700">Reason for price change *</span>
                        <input className="input" value={l.overrideReason} placeholder="e.g. suki discount, rush fee, owner approved" onChange={(e) => update(l.key, { overrideReason: e.target.value })} />
                      </label>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block sm:col-span-2"><span className="label">Specifications / notes</span>
                        <textarea className="input" rows={2} value={l.specsNotes} placeholder="Names, dates, colors, layout instructions…" onChange={(e) => update(l.key, { specsNotes: e.target.value })} />
                      </label>
                      <label className="block"><span className="label">Files from</span>
                        <select className="input" value={l.fileSource} onChange={(e) => update(l.key, { fileSource: e.target.value })}>
                          {options(FILE_SOURCE).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </label>
                      {l.fileSource !== 'NONE' && (
                        <label className="block"><span className="label">File note</span>
                          <input className="input" value={l.fileSourceNote} placeholder="e.g. sent by Juan's email, folder name" onChange={(e) => update(l.key, { fileSourceNote: e.target.value })} />
                        </label>
                      )}
                    </div>
                    {c.errors.length > 0 && (
                      <ul className="list-inside list-disc text-xs text-amber-700">{c.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="btn-secondary" onClick={() => setLines((ls) => [...ls, newLine()])}>+ Add another item</button>
        </div>
      </section>

      {/* 4-5. Details & discount */}
      <section className="card p-4">
        <h2 className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-700"><span className="grid h-5 w-5 place-items-center rounded-[3px] bg-graphite-800 font-mono text-[10.5px] text-white">3</span>Schedule & discount</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Target completion / delivery date</span>
            <input type="date" className="input" min={today} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </label>
          <label className="block"><span className="label">Order notes</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div>
            <span className="label">Discount (₱)</span>
            <div className="flex gap-2">
              <input className="input" inputMode="decimal" value={discountInput} placeholder="0.00" onChange={(e) => { setDiscountAuto(false); setDiscountInput(e.target.value); }} />
              <input className="input w-20" inputMode="decimal" value={pct} placeholder="%" aria-label="Discount percent" onChange={(e) => setPct(e.target.value)} />
              <button type="button" className="btn-secondary whitespace-nowrap" onClick={applyPct}>Apply %</button>
            </div>
            {specialPct > 0 && (
              <span className="mt-1 block text-xs font-medium text-emerald-700">
                {customer?.name} has a special {specialPct}% discount ({peso(specialAmount)}) set by the owner — no PIN needed{discountAuto ? ', filled in automatically' : ''}.
                {!discountAuto && discount !== specialAmount && <button type="button" className="ml-1 underline" onClick={() => { setDiscountInput(specialAmount ? centavosToInput(specialAmount) : ''); setDiscountReason(`Special customer discount (${specialPct}%)`); setDiscountAuto(true); }}>Use it</button>}
              </span>
            )}
          </div>
          {discount > 0 && (
            <>
              <label className="block"><span className="label">Discount reason *</span>
                <input className="input" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
              </label>
              {needsPin && <label className="block"><span className="label">Owner approval PIN *</span>
                <input className="input" type="password" inputMode="numeric" maxLength={8} autoComplete="off" value={discountPin}
                  onChange={(e) => setDiscountPin(e.target.value.replace(/\D/g, ''))} placeholder="Owner enters their PIN to approve" />
                <span className="mt-1 block text-xs text-slate-500">{specialAmount ? `More than the special ${specialPct}% needs the owner's PIN.` : 'Discounts must be approved with the owner\'s PIN.'}</span>
              </label>}
            </>
          )}
          {canUsePoints && (
            <div className="sm:col-span-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block"><span className="label">Use points</span>
                  <input className="input w-28 num" inputMode="numeric" value={pointsInput} placeholder="0" onChange={(e) => setPointsInput(e.target.value.replace(/\D/g, ''))} />
                </label>
                <button type="button" className="btn-secondary btn-sm mb-0.5" onClick={() => setPointsInput(String(maxPoints))} disabled={maxPoints === 0}>Use max ({maxPoints})</button>
                <p className="mb-1 text-[13px] text-emerald-900">
                  {customer!.name} has <b>{customer!.points} points</b> (worth {peso((customer!.points ?? 0) * pointsCfg.value)}). 1 point = {peso(pointsCfg.value)} off{pointsCfg.weekCap > 0 ? ` · at most ${pointsCfg.weekCap} points a week` : ''}.
                  {pointsUsed > 0 && <> Using {pointsUsed} = <b>−{peso(pointsAmount)}</b>.</>}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 6. Payment */}
      <section className="card p-4">
        <h2 className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-700"><span className="grid h-5 w-5 place-items-center rounded-[3px] bg-graphite-800 font-mono text-[10.5px] text-white">4</span>Payment</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block"><span className="label">Terms *</span>
            <select className="input" value={terms} onChange={(e) => onTerms(e.target.value)}>
              {options(PAYMENT_TERMS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Amount paid now (₱)</span>
            <input
              className="input"
              inputMode="decimal"
              value={terms === 'FULL' ? centavosToInput(total) : paidInput}
              readOnly={terms === 'FULL'}
              placeholder="0.00"
              onChange={(e) => setPaidInput(e.target.value)}
            />
          </label>
          <label className="block"><span className="label">Method</span>
            <select className="input" value={method} onChange={(e) => { setMethod(e.target.value); setAccountId(''); }} disabled={!(paid > 0)}>
              {options(PAYMENT_METHOD).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {paid > 0 && method !== 'CASH' && accountChoices.length > 0 && (
            <label className="block"><span className="label">Received in *</span>
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— which {PAYMENT_METHOD[method]} account? —</option>
                {accountChoices.map((a) => <option key={a.id} value={a.id}>{a.label}{a.accountNumber ? ` · ${a.accountNumber}` : ''}</option>)}
              </select>
            </label>
          )}
          <label className="block"><span className="label">Reference no.</span>
            <input className="input" value={reference} placeholder="GCash / bank ref" onChange={(e) => setReference(e.target.value)} disabled={!(paid > 0)} />
          </label>
        </div>
      </section>

      {error && <p className="whitespace-pre-line rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Sticky totals bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span>Subtotal <b>{peso(subtotal)}</b></span>
            {discount > 0 && <span>Discount <b>−{peso(discount)}</b></span>}
            {pointsAmount > 0 && <span>Points <b>−{peso(pointsAmount)}</b></span>}
            <span>Total <b className="text-lg">{peso(total)}</b></span>
            <span>Paid <b>{peso(Number.isFinite(paid) ? paid : 0)}</b></span>
            <span>Balance <b className={balance > 0 ? 'text-red-600' : 'text-emerald-600'}>{peso(balance)}</b></span>
          </div>
          <button type="button" className="btn-primary px-6" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save order'}</button>
        </div>
      </div>
    </div>
  );
}

function CustomerPicker({ customer, onChange }: { customer: PosCustomer | null; onChange: (c: PosCustomer | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', mobile: '', facebook: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const reqId = useRef(0);

  useEffect(() => {
    if (customer || creating) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const r = await searchCustomers(q);
        if (id === reqId.current) setResults(r);
      } catch { /* ignore transient search errors */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q, customer, creating]);

  if (customer) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 p-3">
        <div>
          <div className="font-semibold">{customer.name}</div>
          <div className="text-xs text-slate-500">{[customer.mobile, customer.facebook].filter(Boolean).join(' · ') || 'No contact details'}</div>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => { onChange(null); setQ(''); }}>Change</button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="label">Name *</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </label>
          <label className="block"><span className="label">Mobile</span>
            <input className="input" inputMode="tel" placeholder="09xx xxx xxxx" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </label>
          <label className="block"><span className="label">Facebook name / link</span>
            <input className="input" value={form.facebook} onChange={(e) => setForm({ ...form, facebook: e.target.value })} />
          </label>
        </div>
        {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => startBusy(async () => {
              setErr(null);
              const res = await quickCreateCustomer(form);
              if (res.error || !res.customer) { setErr(res.error ?? 'Could not save the customer.'); return; }
              onChange(res.customer);
              setCreating(false);
              setForm({ name: '', mobile: '', facebook: '' });
            })}
          >
            {busy ? 'Saving…' : 'Save customer'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Search name, mobile or Facebook…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        <button type="button" className="btn-secondary whitespace-nowrap" onClick={() => { setCreating(true); setForm((f) => ({ ...f, name: q })); }}>
          + New customer
        </button>
      </div>
      {open && (
        <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">No customers found. Use “+ New customer”.</li>
          ) : results.map((c) => (
            <li key={c.id}>
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-slate-50" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(c); setOpen(false); }}>
                <span className="text-sm font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-slate-500">{[c.mobile, c.facebook].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
