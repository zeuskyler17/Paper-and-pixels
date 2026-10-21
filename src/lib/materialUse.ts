import type { MaterialUse } from '@prisma/client';
import type { Tx } from './db';

/** Product category name → product line. */
export function lineForCategory(name: string): MaterialUse | null {
  const n = name.toLowerCase();
  if (n.includes('album') || n.includes('photobook')) return 'ALBUM';
  if (n.includes('frame')) return 'FRAME';
  if (n.includes('print') || n.includes('tarp') || n.includes('signage') || n.includes('invitation')) return 'PRINTING';
  return null;
}

/** Name-based fallback for materials no product uses yet. */
export function guessUseFromName(name: string, level: string): MaterialUse | null {
  const n = name.toLowerCase();
  if (level === 'GENERAL' || /clean|glove|rag|alcohol|soap|tissue|trash|broom/.test(n)) return 'GENERAL';
  if (/glass|moulding|molding|frame|backing|hanger|sawtooth/.test(n)) return 'FRAME';
  if (/album|photobook|leather|leatherette|board|pages/.test(n)) return 'ALBUM';
  if (/tarp|ink|toner|paper|cardstock|vinyl|sticker|laminat|eyelet|pvc|sintra/.test(n)) return 'PRINTING';
  return null;
}

/**
 * Work out what each unclassified material is for, from the products that actually use it
 * (bill of materials, following cuttings/conversions to the output material). One line → that
 * line; several → SHARED; none → guess from the name. Returns what was set, for review.
 */
export async function classifyMaterials(tx: Tx, opts: { onlyUnset?: boolean } = {}) {
  const materials = await tx.material.findMany({
    where: opts.onlyUnset === false ? {} : { usedFor: null },
    include: {
      bomLines: { select: { product: { select: { category: { select: { name: true } } } } } },
      conversionsIn: { select: { outputMaterialId: true } },
    },
  });
  const all = await tx.material.findMany({
    select: { id: true, bomLines: { select: { product: { select: { category: { select: { name: true } } } } } } },
  });
  const linesOf = (bom: { product: { category: { name: string } } }[]) =>
    new Set(bom.map((b) => lineForCategory(b.product.category.name)).filter((x): x is MaterialUse => !!x));

  const out: { id: number; name: string; usedFor: MaterialUse | null; basis: string }[] = [];
  for (const m of materials) {
    let lines = linesOf(m.bomLines);
    let basis = 'products that use it';
    if (lines.size === 0 && m.conversionsIn.length > 0) {
      // Raw-raw stock: look at what the cut pieces are used for.
      const outs = new Set(m.conversionsIn.map((c) => c.outputMaterialId));
      lines = new Set(all.filter((a) => outs.has(a.id)).flatMap((a) => [...linesOf(a.bomLines)]));
      basis = 'what it is cut into';
    }
    let usedFor: MaterialUse | null = lines.size === 1 ? [...lines][0] : lines.size > 1 ? 'SHARED' : null;
    if (!usedFor) { usedFor = guessUseFromName(m.name, m.level); basis = usedFor ? 'name' : 'unknown'; }
    if (usedFor) await tx.material.update({ where: { id: m.id }, data: { usedFor } });
    out.push({ id: m.id, name: m.name, usedFor, basis });
  }
  return out;
}
