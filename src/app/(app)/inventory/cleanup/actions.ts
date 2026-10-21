'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertUser } from '@/lib/auth';
import { attempt, type ActionState } from '@/lib/action';
import { audit } from '@/lib/audit';

function ids(fd: FormData): number[] {
  const out = [...new Set(fd.getAll('ids').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
  if (out.length === 0) throw new Error('Tick at least one material first.');
  return out;
}

/**
 * Admin clean-up: permanently remove materials (sample / never used) together with their stock
 * history and bill-of-materials lines. The only hard delete in the app — admin only, every row
 * snapshotted into the audit log. Materials on purchase orders or cuttings cannot be deleted.
 */
export async function deleteMaterials(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await assertUser('admin');
    const list = ids(fd);
    const r = await prisma.$transaction(async (tx) => {
      const mats = await tx.material.findMany({
        where: { id: { in: list } },
        include: { _count: { select: { poItems: true, conversionsIn: true, conversionsOut: true, movements: true, bomLines: true } }, bomLines: { include: { product: { select: { name: true } } } } },
      });
      const blocked = mats.filter((m) => m._count.poItems || m._count.conversionsIn || m._count.conversionsOut);
      if (blocked.length) throw new Error(`Cannot delete ${blocked.map((m) => m.name).join(', ')}: used on a purchase order or a cutting / conversion. Deactivate instead.`);
      const deleted: string[] = [];
      let movements = 0, bom = 0;
      for (const m of mats) {
        const moves = await tx.stockMovement.findMany({ where: { materialId: m.id } });
        await tx.stockMovement.deleteMany({ where: { materialId: m.id } });
        await tx.billOfMaterial.deleteMany({ where: { materialId: m.id } });
        await tx.material.delete({ where: { id: m.id } });
        movements += moves.length; bom += m.bomLines.length;
        await audit(tx, admin.id, 'DELETE', 'Material', m.id,
          `Deleted material ${m.name} (${m._count.movements} movement(s), ${m._count.bomLines} BOM line(s)) — inventory clean-up`,
          { material: { ...m, bomLines: m.bomLines.map((b) => ({ product: b.product.name, quantity: b.quantity })) }, movements: moves });
        deleted.push(m.name);
      }
      return { deleted, movements, bom };
    });
    revalidatePath('/inventory'); revalidatePath('/inventory/cleanup'); revalidatePath('/products');
    return { ok: `Deleted ${r.deleted.length} material(s): ${r.deleted.join(', ')}${r.movements ? ` · ${r.movements} stock history row(s) removed` : ''}${r.bom ? ` · ${r.bom} bill-of-materials line(s) removed from products` : ''}.` };
  });
}

/** Hide materials from lists and pickers without losing their history. */
export async function deactivateMaterials(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await assertUser('admin');
    const list = ids(fd);
    const n = await prisma.$transaction(async (tx) => {
      const mats = await tx.material.findMany({ where: { id: { in: list }, active: true }, select: { id: true, name: true } });
      await tx.material.updateMany({ where: { id: { in: mats.map((m) => m.id) } }, data: { active: false } });
      for (const m of mats) await audit(tx, admin.id, 'UPDATE', 'Material', m.id, `Deactivated material ${m.name} — inventory clean-up`);
      return mats.length;
    });
    revalidatePath('/inventory'); revalidatePath('/inventory/cleanup');
    return { ok: `Deactivated ${n} material(s). They stay in history; tick "Include inactive" on Inventory to see them.` };
  });
}
