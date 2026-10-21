import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser, getBranch } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { fmtQty } from '@/lib/money';
import { fmtDateTime } from '@/lib/dates';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Empty, Field, PageHeader, TableWrap } from '@/components/ui';
import { convertStock } from '../actions';

export const metadata = { title: 'Cutting / conversion' };

const LEVEL_SHORT: Record<string, string> = { RAW_RAW: 'Raw-raw', RAW: 'Raw', CONSUMABLE: 'Consumable', GENERAL: 'Daily', FINISHED: 'Finished' };

export default async function ConvertPage({ searchParams }: { searchParams: Promise<{ input?: string; output?: string }> }) {
  await requireUser('inventory');
  if (getBranch()?.simpleInventory) redirect('/inventory'); // no cutting in simple-inventory branches
  const sp = await searchParams;
  const [materials, recent] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: [{ level: 'asc' }, { name: 'asc' }], select: { id: true, name: true, unit: true, stock: true, level: true } }),
    prisma.materialConversion.findMany({
      orderBy: { id: 'desc' }, take: 30,
      include: {
        inputMaterial: { select: { id: true, name: true, unit: true } },
        outputMaterial: { select: { id: true, name: true, unit: true } },
        user: { select: { name: true } },
      },
    }),
  ]);

  const label = (m: (typeof materials)[number]) => `${m.name} — ${LEVEL_SHORT[m.level]} · stock ${fmtQty(m.stock)} ${m.unit}`;
  const inputs = [...materials].sort((a, b) => Number(b.level === 'RAW_RAW') - Number(a.level === 'RAW_RAW'));
  const outputs = [...materials].sort((a, b) => Number(b.level === 'RAW') - Number(a.level === 'RAW'));
  const selectedInput = materials.find((m) => m.id === Number(sp.input));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cutting / conversion"
        subtitle="Turn purchased (raw-raw) stock into cut/processed (raw) stock."
        actions={<Link href="/inventory" className="btn-secondary">Back to inventory</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Record a conversion" className="lg:col-span-2">
          <ActionForm action={convertStock} className="space-y-4" resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Input material (used up) *" className="sm:col-span-2" hint="Current stock is shown next to each material.">
                <select name="inputMaterialId" required defaultValue={selectedInput?.id ?? ''} className="input">
                  <option value="">— choose —</option>
                  {inputs.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
                </select>
              </Field>
              <Field label="Input qty *" hint="In the input material's unit (e.g. 1 sheet).">
                <input name="inputQty" type="number" step="0.001" min="0.001" required className="input" defaultValue={selectedInput ? 1 : undefined} />
              </Field>
              <div className="hidden sm:block" />
              <Field label="Output material (produced) *" className="sm:col-span-2">
                <select name="outputMaterialId" required defaultValue={Number(sp.output) || ''} className="input">
                  <option value="">— choose —</option>
                  {outputs.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
                </select>
              </Field>
              <Field label="Output qty *" hint="In the output material's unit (e.g. 24 pcs).">
                <input name="outputQty" type="number" step="0.001" min="0.001" required className="input" />
              </Field>
              <Field label="Waste qty" hint="Leftover/offcuts in output units (for reference only).">
                <input name="wasteQty" type="number" step="0.001" min="0" defaultValue="0" className="input" />
              </Field>
              <Field label="Notes" className="sm:col-span-2"><input name="notes" className="input" /></Field>
            </div>
            <SubmitButton>Record conversion</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="How it works">
          <div className="space-y-2 text-sm text-slate-600">
            <p><strong>Example:</strong> 1 full PVC sheet 4x8 ft → 24 pcs 12x12 in + 0.5 pc waste.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Input: <em>PVC sheet 4x8 ft</em>, qty <strong>1</strong></li>
              <li>Output: <em>PVC 12x12 in</em>, qty <strong>24</strong></li>
              <li>Waste: <strong>0.5</strong> (informational)</li>
            </ul>
            <p>The input stock goes down, the output stock goes up. The cost of the input is spread over the output pieces
              (output unit cost = input qty × input cost ÷ output qty) and blended into the output&apos;s average cost.</p>
            <p>You cannot convert more than the input material has in stock.</p>
          </div>
        </Card>
      </div>

      <Card title="Recent conversions">
        {recent.length === 0 ? <Empty>No conversions recorded yet.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>#</th><th>Date</th><th>Input</th><th className="text-right">Used</th><th>Output</th><th className="text-right">Produced</th><th className="text-right">Waste</th><th>Notes</th><th>By</th></tr></thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td className="whitespace-nowrap">{fmtDateTime(c.createdAt)}</td>
                    <td><Link href={`/inventory/${c.inputMaterial.id}`} className="link">{c.inputMaterial.name}</Link></td>
                    <td className="whitespace-nowrap text-right text-red-600">−{fmtQty(c.inputQty)} {c.inputMaterial.unit}</td>
                    <td><Link href={`/inventory/${c.outputMaterial.id}`} className="link">{c.outputMaterial.name}</Link></td>
                    <td className="whitespace-nowrap text-right text-emerald-700">+{fmtQty(c.outputQty)} {c.outputMaterial.unit}</td>
                    <td className="text-right">{c.wasteQty ? fmtQty(c.wasteQty) : '—'}</td>
                    <td className="text-slate-600">{c.notes ?? '—'}</td>
                    <td className="whitespace-nowrap">{c.user.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
