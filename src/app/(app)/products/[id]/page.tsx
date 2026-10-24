import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser, can } from '@/lib/auth';
import { centavosToInput, fmtQty, peso } from '@/lib/money';
import { OPTION_TYPE, PRICING_MODE, options as labelOptions } from '@/lib/labels';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Badge, Card, Empty, Field, PageHeader, Select } from '@/components/ui';
import {
  createBomLine, createOption, createOptionValue, deleteBomLine, deleteOption, deleteOptionValue,
  copyOptionsInto, deleteProduct, updateBomLine, updateOption, updateOptionValue, updateProduct,
} from '../actions';
import { ProductFields } from '../ProductFields';
import { CopyOptionsField } from '../CopyOptionsField';
import { copySources } from '../_copySources';

type OptionRow = {
  id: number; name: string; type: string; required: boolean; unitPrice: number;
  minValue: number | null; maxValue: number | null; defaultValue: number | null; sortOrder: number;
};

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('products_view');
  const admin = can(user, 'products_edit');
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id: Number(id) || 0 },
    include: {
      category: true,
      options: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { values: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
      },
      bom: { orderBy: { id: 'asc' }, include: { material: true, option: true, optionValue: { include: { option: true } }, optionValue2: { include: { option: true } } } },
      _count: { select: { orderItems: true } },
    },
  });
  if (!product) notFound();

  const [categories, materials, sources] = await Promise.all([
    prisma.productCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.material.findMany({
      where: { OR: [{ active: true }, { id: { in: product.bom.map((b) => b.materialId) } }] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, unit: true, active: true },
    }),
    admin ? copySources(product.id) : Promise.resolve([]),
  ]);

  const numberOptions = product.options.filter((o) => o.type === 'NUMBER');
  const valueOptions = product.options.filter((o) => o.type !== 'NUMBER' && o.values.length > 0);
  const materialOptions = materials.map((m) => ({ value: m.id, label: `${m.name} (${m.unit})${m.active ? '' : ' — inactive'}`, unit: m.unit }));
  const unitWord = product.pricingMode === 'PER_SQFT' ? 'sq ft' : product.unit;

  return (
    <div className="space-y-4">
      <PageHeader
        title={product.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {product.category.name} · {PRICING_MODE[product.pricingMode]} · {peso(product.basePrice)} / {unitWord}
            {!product.active && <Badge>Inactive</Badge>}
          </span>
        }
        actions={<Link href="/products" className="btn-secondary">← All products</Link>}
      />
      {!admin && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">View only — only the admin can change prices and options.</p>}

      <fieldset disabled={!admin} className="contents">
        <Card title="Product details">
          <ActionForm action={updateProduct.bind(null, product.id)} className="space-y-4">
            <ProductFields p={product} categories={categories} />
            {admin && <SubmitButton>Save product</SubmitButton>}
          </ActionForm>
        </Card>

        <Card title="Options & price add-ons">
          <p className="mb-3 text-sm text-slate-500">
            Unit price = base price{product.pricingMode === 'PER_SQFT' ? ' × width × height (ft)' : ''} + chosen value price changes + (number entered × price per unit).
            Prefer unticking <b>Active</b> on a value instead of removing it — past orders keep their own copy either way.
          </p>
          {product.options.length === 0 && <Empty>No options. The product is sold at its base price.</Empty>}
          {admin && sources.length > 0 && (
            <details className="mb-3" open={product.options.length === 0}>
              <summary className="cursor-pointer text-sm font-semibold text-brand-700">Copy options &amp; add-on prices from another product</summary>
              <ActionForm action={copyOptionsInto.bind(null, product.id)} className="mt-2 space-y-2"
                confirm={product.options.length > 0 ? 'This product already has options. The copied options are ADDED after them. Continue?' : undefined}>
                <CopyOptionsField sources={sources} initialCategoryId={product.categoryId} />
                <SubmitButton className="btn-secondary btn-sm">Copy options</SubmitButton>
              </ActionForm>
            </details>
          )}
          <div className="space-y-3">
            {product.options.map((o) => (
              <div key={o.id} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.name}</span>
                  <Badge tone="blue">{OPTION_TYPE[o.type]}</Badge>
                  {o.required && <Badge tone="amber">Required</Badge>}
                  {o.type === 'NUMBER' && <span className="text-xs text-slate-500">{peso(o.unitPrice)} per unit</span>}
                </div>
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-brand-700">Edit option settings</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <ActionForm action={updateOption.bind(null, o.id)}>
                      <OptionFields o={o} />
                      {admin && <div className="mt-2"><SubmitButton className="btn-secondary btn-sm">Save option</SubmitButton></div>}
                    </ActionForm>
                    {admin && (
                      <ActionForm action={deleteOption.bind(null, o.id)} confirm={`Remove the option "${o.name}" and all its values?`}>
                        <SubmitButton className="btn-danger btn-sm">Remove option</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </details>

                {o.type !== 'NUMBER' && (
                  <div className="mt-3 space-y-1.5">
                    <div className="hidden grid-cols-[1fr_8rem_5rem_5rem_auto] gap-2 px-1 text-xs font-semibold uppercase text-slate-500 sm:grid">
                      <span>Value</span><span>Price change (₱)</span><span>Sort</span><span>Active</span><span />
                    </div>
                    {o.values.length === 0 && <p className="text-xs text-slate-500">No values yet.</p>}
                    {o.values.map((v) => (
                      <div key={v.id} className={`flex flex-wrap items-start gap-2 ${v.active ? '' : 'opacity-60'}`}>
                        <ActionForm action={updateOptionValue.bind(null, v.id)} className="min-w-0 flex-1">
                          <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_8rem_5rem_5rem_auto]">
                            <input name="label" defaultValue={v.label} className="input col-span-2 sm:col-span-1" required aria-label="Value label" />
                            <input name="priceDelta" defaultValue={centavosToInput(v.priceDelta)} className="input" inputMode="decimal" aria-label="Price change" />
                            <input name="sortOrder" defaultValue={v.sortOrder} className="input" inputMode="numeric" aria-label="Sort order" />
                            <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="active" defaultChecked={v.active} /> Active</label>
                            {admin && <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>}
                          </div>
                        </ActionForm>
                        {admin && (
                          <ActionForm action={deleteOptionValue.bind(null, v.id)} confirm={`Remove "${v.label}"?`}>
                            <SubmitButton className="btn-secondary btn-sm text-red-700">Remove</SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    ))}
                    {admin && (
                      <ActionForm action={createOptionValue.bind(null, o.id)} resetOnSuccess className="pt-1">
                        <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_8rem_5rem_auto]">
                          <input name="label" placeholder="New value, e.g. Leather" className="input col-span-2 sm:col-span-1" required />
                          <input name="priceDelta" placeholder="0.00" className="input" inputMode="decimal" aria-label="Price change" />
                          <input name="sortOrder" defaultValue={o.values.length + 1} className="input" inputMode="numeric" aria-label="Sort order" />
                          <SubmitButton className="btn-primary btn-sm">+ Add value</SubmitButton>
                        </div>
                      </ActionForm>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {admin && (
            <div className="mt-4 rounded-md border border-dashed border-slate-300 p-3">
              <h3 className="mb-2 text-sm font-semibold">Add option</h3>
              <ActionForm action={createOption.bind(null, product.id)} resetOnSuccess>
                <OptionFields o={{ sortOrder: product.options.length + 1 }} />
                <div className="mt-2"><SubmitButton className="btn-primary btn-sm">+ Add option</SubmitButton></div>
              </ActionForm>
            </div>
          )}
        </Card>

        <Card title="Bill of materials (auto stock deduction)">
          <div className="mb-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            <p className="font-medium text-slate-800">How deduction works</p>
            <p className="mt-1">
              When a job for this product starts (or completes — see Settings), each line below is deducted from stock:
            </p>
            <p className="mt-1 font-mono text-xs">
              quantity per unit × order qty{product.pricingMode === 'PER_SQFT' ? ' × area (width × height in sq ft, skipped when “Per piece” is ticked)' : ''} × (number entered for the &quot;multiply by&quot; option, if set)
            </p>
            <p className="mt-1">
              A line with <b>Only when</b> set is used only if the customer chose that value (e.g. &quot;Leather cover&quot; uses leather sheet); <b>and only when</b> adds a second condition (e.g. Size = 10x14 <i>and</i> Paper = Luster).
              Example: 1 photo paper &quot;per leaf&quot; on a 30-leaf album × 2 albums = 60 sheets.
            </p>
            {product.pricingMode === 'PER_SQFT' && (
              <p className="mt-1">
                For this per-square-foot product, quantities are <b>per sq ft</b> (e.g. 1 sq ft of tarpaulin per sq ft) unless <b>Per piece</b> is ticked
                (e.g. 8 eyelets per tarpaulin whatever its size: 8 × 2 tarps = 16 eyelets).
              </p>
            )}
          </div>

          {materials.length === 0 ? (
            <Empty>No materials yet. Add materials in <Link href="/inventory" className="link">Inventory</Link> first.</Empty>
          ) : (
            <div className="space-y-2">
              {product.bom.length === 0 && <p className="text-sm text-slate-500">No material lines yet — stock will not be deducted for this product.</p>}
              {product.bom.map((b) => (
                <div key={b.id} className="rounded-md border border-slate-200 p-2">
                  <div className="mb-1 text-xs text-slate-500">
                    {fmtQty(b.quantity)} {b.material.unit} {b.material.name}
                    {product.pricingMode === 'PER_SQFT' ? (b.perPiece ? ' per piece' : ' per sq ft') : ''}
                    {b.option ? ` × ${b.option.name}` : ''}
                    {b.optionValue ? ` · only when ${b.optionValue.option.name} = ${b.optionValue.label}` : ''}
                    {b.optionValue2 ? ` and ${b.optionValue2.option.name} = ${b.optionValue2.label}` : ''}
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <ActionForm action={updateBomLine.bind(null, b.id)} className="min-w-0 flex-1">
                      <BomFields
                        materials={materialOptions}
                        numberOptions={numberOptions}
                        valueOptions={valueOptions}
                        line={b}
                        perSqft={product.pricingMode === 'PER_SQFT'}
                      />
                      {admin && <div className="mt-2"><SubmitButton className="btn-secondary btn-sm">Save line</SubmitButton></div>}
                    </ActionForm>
                    {admin && (
                      <ActionForm action={deleteBomLine.bind(null, b.id)} confirm={`Remove ${b.material.name} from the bill of materials?`}>
                        <SubmitButton className="btn-secondary btn-sm text-red-700">Remove</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </div>
              ))}
              {admin && (
                <div className="rounded-md border border-dashed border-slate-300 p-3">
                  <h3 className="mb-2 text-sm font-semibold">Add material line</h3>
                  <ActionForm action={createBomLine.bind(null, product.id)} resetOnSuccess>
                    <BomFields materials={materialOptions} numberOptions={numberOptions} valueOptions={valueOptions} perSqft={product.pricingMode === 'PER_SQFT'} />
                    <div className="mt-2"><SubmitButton className="btn-primary btn-sm">+ Add line</SubmitButton></div>
                  </ActionForm>
                </div>
              )}
            </div>
          )}
        </Card>
      </fieldset>

      {admin && (
        <Card title="Delete product">
          {product._count.orderItems > 0 ? (
            <p className="text-sm text-slate-600">This product has been sold {product._count.orderItems} time(s), so it stays for the order history. To take it off the POS, untick <b>Active</b> above and save.</p>
          ) : (
            <ActionForm action={deleteProduct.bind(null, product.id)} confirm={`Delete "${product.name}" with its options, add-on prices and bill of materials? This cannot be undone.`} className="flex flex-wrap items-center gap-3">
              <SubmitButton className="btn-danger">Delete product</SubmitButton>
              <span className="text-[12px] text-slate-500">Only possible while the product has never been ordered. Afterwards, deactivate instead.</span>
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}

function OptionFields({ o }: { o: Partial<OptionRow> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      <Field label="Option name *" className="sm:col-span-2"><input name="name" defaultValue={o.name} className="input" required placeholder="e.g. Cover type, Number of leaves" /></Field>
      <Field label="Type *"><Select name="type" defaultValue={o.type ?? 'SELECT'} options={labelOptions(OPTION_TYPE)} /></Field>
      <Field label="Sort order"><input name="sortOrder" defaultValue={o.sortOrder ?? 0} className="input" inputMode="numeric" /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" name="required" defaultChecked={o.required ?? false} /> Required (cashier must choose / enter it)</label>
      <div className="grid gap-2 rounded-md bg-slate-50 p-2 sm:col-span-4 sm:grid-cols-4">
        <p className="text-xs text-slate-500 sm:col-span-4">For “Number” options only (e.g. number of leaves):</p>
        <Field label="Price per unit (₱)"><input name="unitPrice" defaultValue={o.unitPrice ? centavosToInput(o.unitPrice) : ''} className="input" inputMode="decimal" /></Field>
        <Field label="Minimum"><input name="minValue" defaultValue={o.minValue ?? ''} className="input" inputMode="numeric" /></Field>
        <Field label="Maximum"><input name="maxValue" defaultValue={o.maxValue ?? ''} className="input" inputMode="numeric" /></Field>
        <Field label="Default"><input name="defaultValue" defaultValue={o.defaultValue ?? ''} className="input" inputMode="numeric" /></Field>
      </div>
    </div>
  );
}

function BomFields({
  materials, numberOptions, valueOptions, line, perSqft,
}: {
  perSqft: boolean;
  materials: { value: number; label: string; unit: string }[];
  numberOptions: { id: number; name: string }[];
  valueOptions: { id: number; name: string; values: { id: number; label: string; active: boolean }[] }[];
  line?: { materialId: number; quantity: number; perPiece: boolean; optionId: number | null; optionValueId: number | null; optionValue2Id?: number | null; notes: string | null };
}) {
  // Saved quantities are in the material's own unit, so show that unit (e.g. cm) beside the number.
  const savedUnit = materials.find((m) => m.value === line?.materialId)?.unit ?? '';
  const lengthUnit = ['cm', 'in', 'm'].includes(savedUnit) ? savedUnit : '';
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
      <Field label="Material *" className="lg:col-span-2">
        <Select name="materialId" required defaultValue={line?.materialId} placeholder="— choose —" options={materials} />
      </Field>
      <Field label={perSqft ? 'Qty per sq ft / piece *' : 'Qty per 1 unit *'} hint={lengthUnit ? `Saved in ${lengthUnit} (the material's unit). Pick in / cm / m for the number you type; it is converted to ${lengthUnit}.` : "In the material's unit. For roll paper you can type a length (18 cm, 14 in) or pick the unit; it is converted to the roll's unit."}>
        <div className="flex gap-1">
          <input name="quantity" defaultValue={line?.quantity ?? ''} className="input min-w-0 flex-1" inputMode="decimal" required placeholder="e.g. 1 or 14 in" />
          <select name="qtyUnit" defaultValue={lengthUnit} className="input w-28 shrink-0" aria-label="Unit typed" title="Unit of the number typed">
            <option value="">same as stock</option><option value="in">in</option><option value="cm">cm</option><option value="m">m</option>
          </select>
        </div>
      </Field>
      <Field label="Multiply by">
        <select name="optionId" defaultValue={line?.optionId ?? ''} className="input">
          <option value="">— nothing —</option>
          {numberOptions.map((o) => <option key={o.id} value={o.id}>per {o.name}</option>)}
        </select>
      </Field>
      <Field label="Only when">
        <select name="optionValueId" defaultValue={line?.optionValueId ?? ''} className="input">
          <option value="">— always —</option>
          {valueOptions.map((o) => (
            <optgroup key={o.id} label={o.name}>
              {o.values.map((v) => <option key={v.id} value={v.id}>{v.label}{v.active ? '' : ' (inactive)'}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="and only when" hint="Optional second condition, e.g. Size = 10x14 AND Paper = Luster.">
        <select name="optionValue2Id" defaultValue={line?.optionValue2Id ?? ''} className="input">
          <option value="">— no second condition —</option>
          {valueOptions.map((o) => (
            <optgroup key={o.id} label={o.name}>
              {o.values.map((v) => <option key={v.id} value={v.id}>{v.label}{v.active ? '' : ' (inactive)'}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      {perSqft && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-6">
          <input type="checkbox" name="perPiece" defaultChecked={line?.perPiece ?? false} /> Per piece (not per sq ft) — e.g. eyelets, packaging
        </label>
      )}
      <Field label="Notes" className="sm:col-span-2 lg:col-span-5"><input name="notes" defaultValue={line?.notes ?? ''} className="input" /></Field>
    </div>
  );
}
