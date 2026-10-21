/**
 * Paper & Pixels — seed data.  Run with:  npx prisma db seed
 *
 * Safe to run on an empty database and safe to re-run: users, settings and categories are
 * upserted; suppliers, materials, products and customers are only created when a record with
 * the same name does not exist yet; sample orders/expenses are only added when there are none.
 *
 * All money is in CENTAVOS (₱1,500.00 => 150000). Use p(1500) to write pesos.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient, type MaterialLevel, type OptionType, type PricingMode, type Prisma } from '@prisma/client';
import { computeUnitPrice, type PricingProduct, type Selection } from '../src/lib/pricing';
import { nextNumber } from '../src/lib/counters';
import { EXTRA_PRESET_ROLES, PRESET_ROLES } from '../src/lib/permissions';
import { classifyMaterials } from '../src/lib/materialUse';

const prisma = new PrismaClient();
type Tx = Prisma.TransactionClient;

const DEFAULT_PASSWORD = 'papernpixels123';
const DAY = 86_400_000;

/** Pesos -> centavos. */
const p = (pesos: number) => Math.round(pesos * 100);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Midnight Manila, `days` from today (negative = past). */
function manilaDate(days: number): Date {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(new Date(`${today}T00:00:00+08:00`).getTime() + days * DAY);
}
/** A time-of-day on a Manila date, e.g. at(-3, 10, 30) = 3 days ago, 10:30 AM. */
const at = (days: number, hour: number, minute = 0) => new Date(manilaDate(days).getTime() + (hour * 60 + minute) * 60_000);

// ───────────────────────── Users ─────────────────────────

async function seedUsers() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const users = [
    { username: 'admin', name: 'Owner', role: 'ADMIN' as const },
    { username: 'cashier', name: 'Cashier', role: 'STAFF' as const },
    { username: 'worker', name: 'Juan (Production)', role: 'WORKER' as const },
    { username: 'worker2', name: 'Maria (Production)', role: 'WORKER' as const },
    { username: 'inventory', name: 'Stockroom (Inventory)', role: 'INVENTORY' as const },
  ];
  // Access roles: the locked Admin role plus the editable presets (same as the access_roles migration).
  const roleIds: Record<string, number> = {};
  const admin = await prisma.accessRole.upsert({ where: { name: 'Admin (owner)' }, update: {}, create: { name: 'Admin (owner)', description: 'Owner / administrator — always full access.', isAdmin: true, sortOrder: 0 } });
  roleIds.ADMIN = admin.id;
  for (const [i, p] of PRESET_ROLES.entries()) {
    const r = await prisma.accessRole.upsert({ where: { name: p.name }, update: {}, create: { name: p.name, description: p.description, permissions: p.permissions, sortOrder: i + 1 } });
    roleIds[p.legacy] = r.id;
  }
  for (const [i, p] of EXTRA_PRESET_ROLES.entries()) {
    await prisma.accessRole.upsert({ where: { name: p.name }, update: {}, create: { ...p, sortOrder: PRESET_ROLES.length + i + 1 } });
  }
  const out: Record<string, number> = {};
  for (const u of users) {
    // update: {} — re-running the seed never resets a password someone already changed.
    const row = await prisma.user.upsert({
      where: { username: u.username }, update: {},
      create: { ...u, role: u.role === 'ADMIN' ? 'ADMIN' : 'STAFF', accessRoleId: roleIds[u.role], passwordHash },
    });
    out[u.username] = row.id;
  }
  return out;
}

// ───────────────────────── Settings ─────────────────────────

async function seedSettings() {
  const settings: Record<string, string> = {
    shop_name: 'Paper & Pixels',
    shop_address: 'San Carlos City, Pangasinan',
    shop_contact: '',
    shop_facebook: 'facebook.com/papernpixels',
    shop_email: '',
    receipt_footer: 'Thank you! Please present this slip when claiming your order.',
    bom_deduct_on: 'IN_PROCESS',
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
}

// ───────────────────────── Suppliers ─────────────────────────

const SUPPLIERS = [
  { name: 'Dagupan Paper Supply', contactPerson: 'Aling Nena Castro', mobile: '09175550101', address: 'AB Fernandez Ave., Dagupan City', paymentTerms: 'COD', notes: 'Photo paper, cardstock, album pages, tape.' },
  { name: 'Manila Signage Materials (Online)', contactPerson: 'Ryan Lim', mobile: '09285550202', email: 'orders@example.com', address: 'Binondo, Manila (ships via LBC / J&T)', paymentTerms: 'Bank transfer before shipping', notes: 'Tarpaulin rolls, eco-solvent ink, PVC sheets, eyelets.' },
  { name: 'Pangasinan Glass & Frames', contactPerson: 'Mang Boy Soriano', mobile: '09395550303', address: 'Calasiao, Pangasinan', paymentTerms: '15 days', notes: 'Glass sheets and frame mouldings.' },
];

async function seedSuppliers() {
  const out: Record<string, number> = {};
  for (const s of SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({ where: { name: s.name } });
    out[s.name] = (existing ?? (await prisma.supplier.create({ data: s }))).id;
  }
  return out;
}

// ───────────────────────── Materials ─────────────────────────

type MaterialDef = { name: string; level: MaterialLevel; unit: string; stock: number; reorder: number; cost: number; supplier: string; sku?: string; notes?: string };

const PAPER = 'Dagupan Paper Supply', SIGNAGE = 'Manila Signage Materials (Online)', GLASS = 'Pangasinan Glass & Frames';

const MATERIALS: MaterialDef[] = [
  // Raw-raw: what we buy
  { name: 'PVC sheet 4x8 ft', level: 'RAW_RAW', unit: 'sheet', stock: 6, reorder: 2, cost: p(650), supplier: SIGNAGE, sku: 'RR-PVC48', notes: '3mm. Cut into 12x12 in (32 pcs) or 8x10 in (54 pcs).' },
  { name: 'Tarpaulin roll 4ft x 50yd', level: 'RAW_RAW', unit: 'roll', stock: 2, reorder: 1, cost: p(2800), supplier: SIGNAGE, sku: 'RR-TARP4', notes: '1 roll = 600 sq ft. Convert to "Tarp media (sq ft)" when loading the printer.' },
  { name: 'Photo paper ream A4 (100 sheets)', level: 'RAW_RAW', unit: 'ream', stock: 4, reorder: 2, cost: p(650), supplier: PAPER, sku: 'RR-PPA4' },
  { name: 'Moulding wood stick 8ft', level: 'RAW_RAW', unit: 'pc', stock: 20, reorder: 8, cost: p(180), supplier: GLASS, sku: 'RR-MWOOD' },
  { name: 'Moulding black stick 8ft', level: 'RAW_RAW', unit: 'pc', stock: 15, reorder: 6, cost: p(220), supplier: GLASS, sku: 'RR-MBLK' },
  { name: 'Leatherette roll', level: 'RAW_RAW', unit: 'yard', stock: 12, reorder: 5, cost: p(280), supplier: PAPER, sku: 'RR-LTHR' },
  { name: 'Glass sheet 4x8', level: 'RAW_RAW', unit: 'sheet', stock: 3, reorder: 1, cost: p(1400), supplier: GLASS, sku: 'RR-GLS48', notes: '2mm clear glass.' },
  // Raw: cut / processed in the shop
  { name: 'PVC 12x12 in', level: 'RAW', unit: 'pc', stock: 40, reorder: 16, cost: p(20.5), supplier: SIGNAGE, sku: 'R-PVC1212' },
  { name: 'PVC 8x10 in', level: 'RAW', unit: 'pc', stock: 60, reorder: 20, cost: p(12), supplier: SIGNAGE, sku: 'R-PVC810' },
  { name: 'Glass 8x10', level: 'RAW', unit: 'pc', stock: 30, reorder: 10, cost: p(26), supplier: GLASS, sku: 'R-GLS810' },
  { name: 'Glass 11x14', level: 'RAW', unit: 'pc', stock: 12, reorder: 5, cost: p(45), supplier: GLASS, sku: 'R-GLS1114' },
  { name: 'Glass 16x20', level: 'RAW', unit: 'pc', stock: 6, reorder: 3, cost: p(85), supplier: GLASS, sku: 'R-GLS1620' },
  { name: 'Frame moulding cut – wood', level: 'RAW', unit: 'ft', stock: 64, reorder: 24, cost: p(22.5), supplier: GLASS, sku: 'R-MCUTW' },
  { name: 'Frame moulding cut – black', level: 'RAW', unit: 'ft', stock: 40, reorder: 24, cost: p(27.5), supplier: GLASS, sku: 'R-MCUTB' },
  // Printing consumables
  { name: 'Tarp media', level: 'CONSUMABLE', unit: 'sq ft', stock: 450, reorder: 150, cost: p(4.67), supplier: SIGNAGE, sku: 'C-TARP' },
  { name: 'Eco-solvent ink', level: 'CONSUMABLE', unit: 'ml', stock: 2500, reorder: 1000, cost: p(1.2), supplier: SIGNAGE, sku: 'C-INK', notes: 'CMYK combined; ₱1,200 per liter bottle.' },
  { name: 'Photo paper 4R', level: 'CONSUMABLE', unit: 'sheet', stock: 40, reorder: 100, cost: p(3), supplier: PAPER, sku: 'C-PP4R' },
  { name: 'Photo paper A4', level: 'CONSUMABLE', unit: 'sheet', stock: 180, reorder: 100, cost: p(6.5), supplier: PAPER, sku: 'C-PPA4' },
  { name: 'Invitation cardstock', level: 'CONSUMABLE', unit: 'sheet', stock: 600, reorder: 200, cost: p(8), supplier: PAPER, sku: 'C-CARD' },
  { name: 'Album pages / photobook sheet', level: 'CONSUMABLE', unit: 'sheet', stock: 150, reorder: 60, cost: p(45), supplier: PAPER, sku: 'C-ALBPG' },
  { name: 'Eyelets', level: 'CONSUMABLE', unit: 'pc', stock: 80, reorder: 200, cost: p(0.5), supplier: SIGNAGE, sku: 'C-EYE' },
  { name: 'Double-sided tape', level: 'CONSUMABLE', unit: 'roll', stock: 10, reorder: 4, cost: p(35), supplier: PAPER, sku: 'C-TAPE' },
];

async function seedMaterials(suppliers: Record<string, number>, adminId: number) {
  const out: Record<string, number> = {};
  for (const m of MATERIALS) {
    const existing = await prisma.material.findFirst({ where: { name: m.name } });
    if (existing) { out[m.name] = existing.id; continue; }
    const stock = round3(m.stock);
    const mat = await prisma.$transaction(async (tx) => {
      const mat = await tx.material.create({
        data: {
          name: m.name, sku: m.sku ?? null, level: m.level, unit: m.unit, stock, reorderLevel: m.reorder,
          unitCost: m.cost, supplierId: suppliers[m.supplier], notes: m.notes ?? null,
        },
      });
      // Opening stock is recorded as a movement so the stock card adds up from day one.
      await tx.stockMovement.create({
        data: { materialId: mat.id, type: 'ADJUSTMENT', quantity: stock, unitCost: m.cost, balanceAfter: stock, notes: 'Opening stock (seed)', userId: adminId },
      });
      return mat;
    });
    out[m.name] = mat.id;
  }
  return out;
}

// ───────────────────────── Product categories & products ─────────────────────────

const CATEGORIES = [
  { name: 'Wedding Album', requiresProduction: true, sortOrder: 1 },
  { name: 'Picture Frame', requiresProduction: true, sortOrder: 2 },
  { name: 'Printing Press', requiresProduction: true, sortOrder: 3 },
  { name: 'Photo Printing', requiresProduction: false, sortOrder: 4 },
];

type OptionDef = {
  name: string;
  type: OptionType;
  required?: boolean;
  unitPrice?: number; // pesos per unit (NUMBER)
  min?: number; max?: number; def?: number;
  values?: [label: string, deltaPesos: number][];
};
type BomDef = {
  material: string;
  qty: number;
  perOption?: string; // multiply by this NUMBER option's value
  whenValue?: [option: string, label: string]; // only when this value is chosen
  perPiece?: boolean; // PER_SQFT products: quantity is per piece, not per sq ft
  notes?: string;
};
type ProductDef = {
  category: string; name: string; description: string; pricingMode: PricingMode; base: number; unit: string;
  options: OptionDef[]; bom: BomDef[];
};

const FRAME_SIZES = ['4R', '5R', '8R', 'A4', '11x14', '16x20'];
/** Per frame size: moulding ft (perimeter + allowance), glass and backing. */
const FRAME_PARTS: Record<string, { ft: number; glass: string; glassQty: number; pvc: string; pvcQty: number }> = {
  '4R': { ft: 2, glass: 'Glass 8x10', glassQty: 1, pvc: 'PVC 8x10 in', pvcQty: 1 },
  '5R': { ft: 2.5, glass: 'Glass 8x10', glassQty: 1, pvc: 'PVC 8x10 in', pvcQty: 1 },
  '8R': { ft: 3.5, glass: 'Glass 8x10', glassQty: 1, pvc: 'PVC 8x10 in', pvcQty: 1 },
  A4: { ft: 4, glass: 'Glass 11x14', glassQty: 1, pvc: 'PVC 12x12 in', pvcQty: 1 },
  '11x14': { ft: 4.5, glass: 'Glass 11x14', glassQty: 1, pvc: 'PVC 12x12 in', pvcQty: 2 },
  '16x20': { ft: 6.5, glass: 'Glass 16x20', glassQty: 1, pvc: 'PVC 12x12 in', pvcQty: 3 },
};

function frameProduct(name: string, base: number, deltas: number[], moulding: string): ProductDef {
  const bom: BomDef[] = [{ material: 'Double-sided tape', qty: 0.05, notes: 'Backing & mounting' }];
  for (const size of FRAME_SIZES) {
    const part = FRAME_PARTS[size];
    bom.push(
      { material: moulding, qty: part.ft, whenValue: ['Size', size] },
      { material: part.glass, qty: part.glassQty, whenValue: ['Size', size] },
      { material: part.pvc, qty: part.pvcQty, whenValue: ['Size', size], notes: 'Backing board' },
    );
  }
  bom.push({ material: 'Photo paper A4', qty: 1, whenValue: ['Add-ons', 'Print & mount photo'] });
  return {
    category: 'Picture Frame', name, pricingMode: 'FIXED', base, unit: 'pc',
    description: 'Ready-made frame with glass and backing, made to the chosen photo size.',
    options: [
      { name: 'Size', type: 'SELECT', required: true, values: FRAME_SIZES.map((s, i) => [s, deltas[i]] as [string, number]) },
      { name: 'Add-ons', type: 'MULTI', values: [['Print & mount photo', 80], ['Name / date engraving plate', 150]] },
    ],
    bom,
  };
}

const PRODUCTS: ProductDef[] = [
  {
    category: 'Wedding Album', name: 'Custom Wedding Album', pricingMode: 'FIXED', base: 1500, unit: 'pc',
    description: 'Lay-flat wedding album. Price = base + cover + size + ₱120 per leaf + add-ons.',
    options: [
      { name: 'Cover type', type: 'SELECT', required: true, values: [['Leatherette', 0], ['Genuine leather', 1200], ['Acrylic photo cover', 900], ['Wood', 1500]] },
      { name: 'Size', type: 'SELECT', required: true, values: [['8x8', 0], ['10x10', 800], ['12x12', 1600]] },
      { name: 'Number of leaves', type: 'NUMBER', required: true, unitPrice: 120, min: 10, max: 60, def: 20 },
      { name: 'Add-ons', type: 'MULTI', values: [['Album box', 650], ['USB with soft copies', 450], ['Name engraving', 350]] },
    ],
    bom: [
      { material: 'Album pages / photobook sheet', qty: 1, perOption: 'Number of leaves', notes: '1 sheet per leaf' },
      { material: 'PVC 8x10 in', qty: 2, whenValue: ['Size', '8x8'], notes: 'Front & back cover boards' },
      { material: 'PVC 12x12 in', qty: 2, whenValue: ['Size', '10x10'], notes: 'Front & back cover boards (cut down)' },
      { material: 'PVC 12x12 in', qty: 2, whenValue: ['Size', '12x12'], notes: 'Front & back cover boards' },
      { material: 'Leatherette roll', qty: 0.5, whenValue: ['Cover type', 'Leatherette'] },
      { material: 'Double-sided tape', qty: 0.25 },
    ],
  },
  frameProduct('Picture Frame – Classic Wood', 150, [0, 50, 150, 200, 400, 700], 'Frame moulding cut – wood'),
  frameProduct('Picture Frame – Modern Black', 180, [0, 60, 170, 230, 450, 800], 'Frame moulding cut – black'),
  {
    category: 'Printing Press', name: 'Tarpaulin', pricingMode: 'PER_SQFT', base: 18, unit: 'pc',
    description: 'Eco-solvent tarpaulin print, ₱18 per sq ft (width × height in feet).',
    options: [
      { name: 'Finish', type: 'SELECT', required: true, values: [['Plain', 0], ['With eyelets', 50], ['With wooden frame', 250]] },
    ],
    bom: [
      { material: 'Tarp media', qty: 1, notes: '1 sq ft per sq ft printed' },
      { material: 'Eco-solvent ink', qty: 2, notes: '≈2 ml per sq ft' },
      { material: 'Eyelets', qty: 8, perPiece: true, whenValue: ['Finish', 'With eyelets'], notes: '8 pcs per tarp' },
      { material: 'Frame moulding cut – wood', qty: 1, whenValue: ['Finish', 'With wooden frame'], notes: '≈ perimeter; per sq ft' },
    ],
  },
  {
    category: 'Printing Press', name: 'Wedding Invitation', pricingMode: 'FIXED', base: 35, unit: 'pc',
    description: 'Printed invitation card, price per piece.',
    options: [
      { name: 'Paper', type: 'SELECT', required: true, values: [['Matte', 0], ['Pearl', 15], ['Textured', 20]] },
      { name: 'Envelope', type: 'MULTI', values: [['Envelope', 10], ['Wax seal', 25]] },
    ],
    bom: [{ material: 'Invitation cardstock', qty: 1 }],
  },
  {
    category: 'Printing Press', name: 'Flyers (A5)', pricingMode: 'FIXED', base: 5, unit: 'pc',
    description: 'A5 flyers, full color one side, price per piece.',
    options: [{ name: 'Paper', type: 'SELECT', required: true, values: [['80gsm', 0], ['Glossy 120gsm', 2]] }],
    bom: [],
  },
  {
    category: 'Photo Printing', name: 'Photo Print', pricingMode: 'FIXED', base: 0, unit: 'pc',
    description: 'Walk-in photo printing (no production job).',
    options: [
      { name: 'Size', type: 'SELECT', required: true, values: [['3R', 8], ['4R', 10], ['5R', 20], ['8R', 45], ['A4', 55]] },
      { name: 'Paper', type: 'SELECT', required: true, values: [['Glossy', 0], ['Matte', 0], ['Luster', 5]] },
    ],
    bom: [
      { material: 'Photo paper 4R', qty: 1, whenValue: ['Size', '3R'] },
      { material: 'Photo paper 4R', qty: 1, whenValue: ['Size', '4R'] },
      { material: 'Photo paper A4', qty: 0.5, whenValue: ['Size', '5R'], notes: '2 per A4 sheet' },
      { material: 'Photo paper A4', qty: 1, whenValue: ['Size', '8R'] },
      { material: 'Photo paper A4', qty: 1, whenValue: ['Size', 'A4'] },
    ],
  },
];

async function seedCatalog(materials: Record<string, number>) {
  const cats: Record<string, number> = {};
  for (const c of CATEGORIES) {
    const row = await prisma.productCategory.upsert({ where: { name: c.name }, update: {}, create: c });
    cats[c.name] = row.id;
  }

  for (const def of PRODUCTS) {
    if (await prisma.product.findFirst({ where: { name: def.name } })) continue;
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          categoryId: cats[def.category], name: def.name, description: def.description,
          pricingMode: def.pricingMode, basePrice: p(def.base), unit: def.unit,
          options: {
            create: def.options.map((o, i) => ({
              name: o.name, type: o.type, required: o.required ?? false, unitPrice: p(o.unitPrice ?? 0),
              minValue: o.min ?? null, maxValue: o.max ?? null, defaultValue: o.def ?? null, sortOrder: i,
              values: { create: (o.values ?? []).map(([label, delta], j) => ({ label, priceDelta: p(delta), sortOrder: j })) },
            })),
          },
        },
        include: { options: { include: { values: true } } },
      });
      for (const b of def.bom) {
        const materialId = materials[b.material];
        if (!materialId) throw new Error(`BOM for ${def.name}: unknown material "${b.material}"`);
        let optionId: number | null = null;
        let optionValueId: number | null = null;
        if (b.perOption) {
          optionId = product.options.find((o) => o.name === b.perOption)?.id ?? null;
          if (!optionId) throw new Error(`BOM for ${def.name}: unknown option "${b.perOption}"`);
        }
        if (b.whenValue) {
          const opt = product.options.find((o) => o.name === b.whenValue![0]);
          optionValueId = opt?.values.find((v) => v.label === b.whenValue![1])?.id ?? null;
          if (!optionValueId) throw new Error(`BOM for ${def.name}: unknown value "${b.whenValue.join(' / ')}"`);
        }
        await tx.billOfMaterial.create({ data: { productId: product.id, materialId, quantity: b.qty, perPiece: b.perPiece ?? false, optionId, optionValueId, notes: b.notes ?? null } });
      }
    });
  }
}

// ───────────────────────── Expense categories & customers ─────────────────────────

async function seedExpenseCategories() {
  const out: Record<string, number> = {};
  for (const name of ['Materials', 'Utilities', 'Salaries', 'Transport', 'Meals', 'Others']) {
    out[name] = (await prisma.expenseCategory.upsert({ where: { name }, update: {}, create: { name } })).id;
  }
  return out;
}

const CUSTOMERS = [
  { name: 'Angelica Dela Cruz', mobile: '09171234567', facebook: 'Angelica Dela Cruz', address: 'Brgy. Lucao, Dagupan City, Pangasinan', notes: 'Wedding on the 28th. Prefers GCash.' },
  { name: 'Mark Anthony Reyes', mobile: '09281234567', facebook: 'Mark Anthony Reyes', address: 'Brgy. Bonuan Gueset, Dagupan City, Pangasinan' },
  { name: 'Kristine Mae Fernandez', mobile: '09391234567', facebook: 'Tin Fernandez', address: 'Poblacion, Calasiao, Pangasinan', notes: 'Suki — allowed to pay later (credit).' },
  { name: 'Jerome Villanueva', mobile: '09451234567', facebook: 'Jerome Villanueva (JV Eats)', address: 'Brgy. Pantal, Dagupan City, Pangasinan', notes: 'Owns a food stall; orders flyers regularly.' },
  { name: 'Rowena Bautista', mobile: '09561234567', facebook: 'Weng Bautista', address: 'Brgy. Alacan, San Fabian, Pangasinan' },
];

async function seedCustomers() {
  const out: Record<string, number> = {};
  for (const c of CUSTOMERS) {
    const existing = await prisma.customer.findFirst({ where: { name: c.name } });
    out[c.name] = (existing ?? (await prisma.customer.create({ data: c }))).id;
  }
  return out;
}

// ───────────────────────── Sample orders ─────────────────────────

type LineInput = {
  product: string;
  qty: number;
  choose: Record<string, string | string[] | number>; // option name -> value label(s) or number
  widthFt?: number; heightFt?: number;
  specsNotes?: string;
  fileSource?: 'NONE' | 'GMAIL' | 'USB' | 'MESSENGER' | 'OTHER';
  fileSourceNote?: string;
  job?: { status: 'PENDING' | 'IN_PROCESS' | 'QUALITY_CHECK' | 'COMPLETED'; assignTo?: string; notes?: string[] };
};
type OrderInput = {
  customer: string;
  daysAgo: number;
  terms: 'FULL' | 'DOWNPAYMENT' | 'PAY_AFTER' | 'CREDIT';
  targetInDays: number | null;
  discount?: { pesos: number; reason: string };
  notes?: string;
  lines: LineInput[];
  payments: { pesos: number | 'HALF' | 'BALANCE'; method: 'CASH' | 'GCASH' | 'MAYA' | 'BANK_TRANSFER'; reference?: string; daysAgo: number }[];
  delivered?: { daysAgo: number; delivery?: { method: 'LALAMOVE_GRAB' | 'PICKUP'; rider?: string; fee: number } };
};

const SAMPLE_ORDERS: OrderInput[] = [
  {
    customer: 'Angelica Dela Cruz', daysAgo: 6, terms: 'DOWNPAYMENT', targetInDays: 8,
    discount: { pesos: 500, reason: 'Wedding package (album + invitations)' },
    notes: 'Couple: Angelica & Paolo — wedding date on the slip.',
    lines: [
      {
        product: 'Custom Wedding Album', qty: 1,
        choose: { 'Cover type': 'Genuine leather', Size: '12x12', 'Number of leaves': 30, 'Add-ons': ['Album box', 'USB with soft copies'] },
        specsNotes: 'Cover text: "Angelica & Paolo · 10.28.2026" in gold foil. Layout follows the PDF proof v2.',
        fileSource: 'GMAIL', fileSourceNote: 'Photos sent to shop Gmail (Google Drive link, 320 photos)',
        job: { status: 'IN_PROCESS', assignTo: 'worker', notes: ['Layout approved by client via Messenger.'] },
      },
      {
        product: 'Wedding Invitation', qty: 100,
        choose: { Paper: 'Pearl', Envelope: ['Envelope', 'Wax seal'] },
        specsNotes: 'Sage green theme, wax seal color: gold. Proofread names before printing.',
        fileSource: 'MESSENGER', fileSourceNote: 'Final design PNG via Messenger',
        job: { status: 'PENDING', assignTo: 'worker2' },
      },
    ],
    payments: [{ pesos: 'HALF', method: 'GCASH', reference: '1009 845 221', daysAgo: 6 }],
  },
  {
    customer: 'Mark Anthony Reyes', daysAgo: 3, terms: 'FULL', targetInDays: -1,
    lines: [
      {
        product: 'Tarpaulin', qty: 2, widthFt: 3, heightFt: 6, choose: { Finish: 'With eyelets' },
        specsNotes: '"Happy 7th Birthday Liam!" — Paw Patrol theme. One for the gate, one for the stage.',
        fileSource: 'USB',
        job: { status: 'COMPLETED', assignTo: 'worker', notes: ['Printed and eyelets installed.'] },
      },
    ],
    payments: [{ pesos: 'BALANCE', method: 'CASH', daysAgo: 3 }],
  },
  {
    customer: 'Kristine Mae Fernandez', daysAgo: 4, terms: 'CREDIT', targetInDays: -1,
    notes: 'On credit — will pay on the 30th (payday).',
    lines: [
      {
        product: 'Picture Frame – Classic Wood', qty: 2, choose: { Size: '8R', 'Add-ons': ['Print & mount photo'] },
        specsNotes: 'Graduation photos (2 different). Matte finish print.',
        fileSource: 'MESSENGER',
        job: { status: 'PENDING' },
      },
      { product: 'Photo Print', qty: 20, choose: { Size: '4R', Paper: 'Glossy' }, fileSource: 'USB' },
    ],
    payments: [],
  },
  {
    customer: 'Jerome Villanueva', daysAgo: 9, terms: 'DOWNPAYMENT', targetInDays: -5,
    lines: [
      {
        product: 'Flyers (A5)', qty: 500, choose: { Paper: 'Glossy 120gsm' },
        specsNotes: 'JV Eats menu flyer, front only.', fileSource: 'GMAIL',
        job: { status: 'COMPLETED', assignTo: 'worker2' },
      },
    ],
    payments: [
      { pesos: 1500, method: 'CASH', daysAgo: 9 },
      { pesos: 'BALANCE', method: 'GCASH', reference: '2031 554 870', daysAgo: 4 },
    ],
    delivered: { daysAgo: 4, delivery: { method: 'LALAMOVE_GRAB', rider: 'Lalamove — Rodel', fee: 120 } },
  },
];

type FullProduct = Prisma.ProductGetPayload<{ include: { category: true; options: { include: { values: true } }; bom: true } }>;

function toPricing(prod: FullProduct): PricingProduct {
  return {
    id: prod.id, name: prod.name, pricingMode: prod.pricingMode, basePrice: prod.basePrice,
    options: prod.options.map((o) => ({
      id: o.id, name: o.name, type: o.type, required: o.required, unitPrice: o.unitPrice,
      minValue: o.minValue, maxValue: o.maxValue,
      values: o.values.map((v) => ({ id: v.id, label: v.label, priceDelta: v.priceDelta, active: v.active })),
    })),
  };
}

function toSelection(prod: FullProduct, choose: LineInput['choose']): Selection {
  const sel: Selection = {};
  for (const [name, want] of Object.entries(choose)) {
    const opt = prod.options.find((o) => o.name === name);
    if (!opt) throw new Error(`${prod.name}: unknown option "${name}"`);
    const idOf = (label: string) => {
      const v = opt.values.find((x) => x.label === label);
      if (!v) throw new Error(`${prod.name}: unknown value "${label}" for ${name}`);
      return v.id;
    };
    if (typeof want === 'number') sel[opt.id] = want;
    else if (Array.isArray(want)) sel[opt.id] = want.map(idOf);
    else sel[opt.id] = idOf(want);
  }
  return sel;
}

/** Mirrors deductBomForJob() in src/lib/inventory.ts (without importing the app's Prisma client). */
async function deductBom(tx: Tx, jobId: number, orderNo: string, userId: number, when: Date) {
  const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, include: { orderItem: { include: { specs: true, product: { include: { bom: true } } } } } });
  const item = job.orderItem;
  const area = item.product.pricingMode === 'PER_SQFT' ? (item.widthFt ?? 0) * (item.heightFt ?? 0) : 1;
  for (const line of item.product.bom) {
    if (line.optionValueId && !item.specs.some((s) => s.optionValueId === line.optionValueId)) continue;
    let multiplier = 1;
    if (line.optionId) {
      const spec = item.specs.find((s) => s.optionId === line.optionId && s.numberValue != null);
      if (!spec) continue;
      multiplier = spec.numberValue!;
    }
    const qty = round3(line.quantity * item.quantity * (line.perPiece ? 1 : area) * multiplier);
    if (qty <= 0) continue;
    const mat = await tx.material.findUniqueOrThrow({ where: { id: line.materialId } });
    const balanceAfter = round3(mat.stock - qty);
    await tx.material.update({ where: { id: mat.id }, data: { stock: balanceAfter } });
    await tx.stockMovement.create({
      data: { materialId: mat.id, type: 'JOB_DEDUCT', quantity: -qty, unitCost: mat.unitCost, balanceAfter, jobId, userId, notes: `${orderNo} · ${item.description}`, createdAt: when },
    });
  }
  await tx.job.update({ where: { id: jobId }, data: { materialsDeducted: true } });
}

const FLOW = ['PENDING', 'IN_PROCESS', 'QUALITY_CHECK', 'COMPLETED'] as const;

async function seedOrders(users: Record<string, number>, customers: Record<string, number>) {
  if ((await prisma.order.count()) > 0) return 0;
  const products = await prisma.product.findMany({ include: { category: true, options: { include: { values: true } }, bom: true } });
  const productByName = new Map(products.map((x) => [x.name, x]));
  const cashierId = users.cashier;

  for (const o of SAMPLE_ORDERS) {
    await prisma.$transaction(async (tx) => {
      const createdAt = at(-o.daysAgo, 10, 15);
      const targetDate = o.targetInDays == null ? null : manilaDate(o.targetInDays);

      // Price every line with the same function the POS uses.
      const lines = o.lines.map((l) => {
        const prod = productByName.get(l.product);
        if (!prod) throw new Error(`Unknown product ${l.product}`);
        const res = computeUnitPrice(toPricing(prod), toSelection(prod, l.choose), l.widthFt, l.heightFt);
        if (res.errors.length) throw new Error(res.errors.join(' '));
        return { l, prod, res, lineTotal: res.unitPrice * l.qty };
      });
      const subtotal = lines.reduce((s, x) => s + x.lineTotal, 0);
      const discount = o.discount ? p(o.discount.pesos) : 0;
      const total = subtotal - discount;

      const orderNo = await nextNumber(tx, 'PP');
      const order = await tx.order.create({
        data: {
          orderNo, customerId: customers[o.customer], paymentTerms: o.terms, subtotal, discount,
          discountReason: o.discount?.reason ?? null, total, balance: total, targetDate, notes: o.notes ?? null,
          createdById: cashierId, createdAt,
        },
      });

      const jobStatuses: string[] = [];
      for (const { l, prod, res, lineTotal } of lines) {
        const item = await tx.orderItem.create({
          data: {
            orderId: order.id, productId: prod.id, description: prod.name, quantity: l.qty,
            widthFt: l.widthFt ?? null, heightFt: l.heightFt ?? null,
            suggestedUnitPrice: res.unitPrice, unitPrice: res.unitPrice, lineTotal,
            specsNotes: l.specsNotes ?? null, fileSource: l.fileSource ?? 'NONE', fileSourceNote: l.fileSourceNote ?? null,
            specs: { create: res.specs.map((s) => ({ optionId: s.optionId, optionValueId: s.optionValueId, name: s.name, value: s.value, numberValue: s.numberValue, priceEffect: s.priceEffect })) },
          },
        });
        if (!prod.category.requiresProduction) continue;

        // One job per production line, walked through its statuses with a log row per step.
        const status = l.job?.status ?? 'PENDING';
        const assignedToId = l.job?.assignTo ? users[l.job.assignTo] : null;
        const startedAt = status !== 'PENDING' ? at(-o.daysAgo + 1, 9) : null;
        const completedAt = status === 'COMPLETED' ? at(-o.daysAgo + 2, 16) : null;
        const job = await tx.job.create({
          data: { orderId: order.id, orderItemId: item.id, status, assignedToId, dueDate: targetDate, startedAt, completedAt, createdAt },
        });
        const steps = FLOW.slice(0, FLOW.indexOf(status) + 1);
        for (let i = 1; i < steps.length; i++) {
          const when = steps[i] === 'COMPLETED' ? completedAt! : new Date(startedAt!.getTime() + (i - 1) * 3 * 3600_000);
          await tx.jobStatusLog.create({ data: { jobId: job.id, fromStatus: steps[i - 1], toStatus: steps[i], userId: assignedToId ?? cashierId, createdAt: when } });
          if (steps[i] === 'IN_PROCESS') await deductBom(tx, job.id, orderNo, assignedToId ?? cashierId, when); // bom_deduct_on = IN_PROCESS
        }
        for (const note of l.job?.notes ?? []) {
          await tx.jobStatusLog.create({ data: { jobId: job.id, note, userId: assignedToId ?? cashierId, createdAt: startedAt ?? createdAt } });
        }
        jobStatuses.push(status);
      }

      // Payments (AR numbers from the same counter logic as the app).
      let paid = 0;
      for (const pay of o.payments) {
        const amount = pay.pesos === 'HALF' ? Math.round(total / 2 / 100) * 100 : pay.pesos === 'BALANCE' ? total - paid : p(pay.pesos);
        if (amount <= 0) continue;
        const receiptNo = await nextNumber(tx, 'AR');
        const paidAt = at(-pay.daysAgo, 10, 30);
        await tx.payment.create({
          data: { receiptNo, orderId: order.id, customerId: order.customerId, amount, method: pay.method, reference: pay.reference ?? null, paidAt, receivedById: cashierId, createdAt: paidAt },
        });
        paid += amount;
      }

      // Same rules as recalcOrder() and syncOrderStatusFromJobs().
      let status: 'PENDING' | 'IN_PRODUCTION' | 'COMPLETED' | 'DELIVERED' = 'PENDING';
      if (jobStatuses.length && jobStatuses.every((s) => s === 'COMPLETED')) status = 'COMPLETED';
      else if (jobStatuses.some((s) => s !== 'PENDING')) status = 'IN_PRODUCTION';
      const balance = total - paid;
      if (o.delivered && balance === 0) status = 'DELIVERED';
      const paymentStatus = paid <= 0 ? (total === 0 ? 'PAID' : 'UNPAID') : paid >= total ? 'PAID' : 'PARTIAL';
      const deliveredAt = status === 'DELIVERED' ? at(-o.delivered!.daysAgo, 15) : null;
      await tx.order.update({ where: { id: order.id }, data: { amountPaid: paid, balance, paymentStatus, status, deliveredAt } });

      const d = o.delivered?.delivery;
      if (d && deliveredAt) {
        const cust = await tx.customer.findUniqueOrThrow({ where: { id: order.customerId } });
        await tx.delivery.create({
          data: {
            orderId: order.id, method: d.method, address: cust.address, recipient: cust.name, contactNo: cust.mobile,
            rider: d.rider ?? null, fee: p(d.fee), scheduledDate: manilaDate(-o.delivered!.daysAgo), deliveredAt,
            status: 'DELIVERED', createdById: cashierId, createdAt: deliveredAt,
          },
        });
      }
      await tx.auditLog.create({ data: { userId: cashierId, action: 'CREATE', entity: 'Order', entityId: String(order.id), summary: `Created ${orderNo} (sample data)`, createdAt } });
    });
  }
  return SAMPLE_ORDERS.length;
}

async function seedExpenses(categories: Record<string, number>, adminId: number) {
  if ((await prisma.expense.count()) > 0) return;
  const rows = [
    { days: -5, cat: 'Utilities', amount: 3850, via: 'GCASH' as const, notes: 'Dagupan Electric bill' },
    { days: -3, cat: 'Transport', amount: 300, via: 'CASH' as const, notes: 'Tricycle — pick up glass from Calasiao' },
    { days: -1, cat: 'Meals', amount: 450, via: 'CASH' as const, notes: 'Lunch for production team (rush order)' },
  ];
  for (const r of rows) {
    await prisma.expense.create({ data: { date: manilaDate(r.days), categoryId: categories[r.cat], amount: p(r.amount), paidVia: r.via, notes: r.notes, createdById: adminId } });
  }
}

// ───────────────────────── Main ─────────────────────────

// ───────────── HR: sample employees, time records, SSS, cash advance, incident ─────────────

const SAMPLE_EMPLOYEES = [
  { login: 'worker', first: 'Juan', last: 'Dela Cruz', position: 'Production – Albums & Frames', payType: 'DAILY' as const, rate: 550, pin: '1111', sss: 450 },
  { login: 'worker2', first: 'Maria', last: 'Santos', position: 'Production – Printing', payType: 'DAILY' as const, rate: 520, pin: '2222', sss: 425 },
  { login: 'cashier', first: 'Liza', last: 'Manalo', position: 'Cashier', payType: 'MONTHLY' as const, rate: 15000, pin: '3333', sss: 675 },
  { login: 'inventory', first: 'Ramon', last: 'Cruz', position: 'Stockroom', payType: 'DAILY' as const, rate: 500, pin: '4444', sss: 400 },
];

/** Only runs when there are no employees yet. Time records use the same rules as the app. */
async function seedEmployees(users: Record<string, number>) {
  if ((await prisma.employee.count()) > 0) return 0;
  const { computeEntry, dayTypeFor } = await import('../src/lib/timekeeping');
  const sched = { shiftStart: '08:00', shiftEnd: '17:00', breakMinutes: 60, workDays: '1,2,3,4,5,6' };
  const today = toDateStr(manilaDate(0));
  let n = 0;
  for (const [i, e] of SAMPLE_EMPLOYEES.entries()) {
    n++;
    const userId = users[e.login] ?? null;
    const linked = userId ? await prisma.employee.findUnique({ where: { userId } }) : null;
    await prisma.$transaction(async (tx) => {
      const no = await tx.$queryRaw<{ value: number }[]>`
        INSERT INTO "counters" ("key", "value") VALUES ('EMP', 1)
        ON CONFLICT ("key") DO UPDATE SET "value" = "counters"."value" + 1 RETURNING "value"`;
      const emp = await tx.employee.create({
        data: {
          employeeNo: `EMP-${String(no[0].value).padStart(4, '0')}`, firstName: e.first, lastName: e.last, position: e.position,
          payType: e.payType, rate: p(e.rate), payFrequency: 'SEMI_MONTHLY', ...sched,
          hireDate: manilaDate(-400 + i * 30), mobile: `0917555010${i}`, address: 'San Carlos City, Pangasinan',
          pinHash: await bcrypt.hash(e.pin, 10), userId: linked ? null : userId,
          sssNo: `34-${1234567 + i}-${i}`,
        },
      });
      await tx.recurringDeduction.create({ data: { employeeId: emp.id, name: 'SSS', amount: p(e.sss), schedule: 'ONCE_A_MONTH' } });

      // Last 14 days of time records (skip today and rest days), with a few late days, OT and one absence.
      for (let d = -14; d <= -1; d++) {
        const workDate = manilaDate(d);
        const dateStr = toDateStr(workDate);
        const dayType = dayTypeFor(sched, dateStr);
        if (dayType !== 'REGULAR' || dateStr >= today) continue;
        if (i === 1 && d === -6) continue; // Maria absent one day
        const lateMin = (i === 0 && (d === -9 || d === -4 || d === -2)) ? 12 + (-d) : (d * 7 + i * 3) % 5;
        const outExtra = i === 0 && d === -3 ? 120 : i === 3 && d === -5 ? 90 : (d * 3 + i) % 4;
        const timeIn = new Date(workDate.getTime() + (8 * 60 - 4 + lateMin) * 60_000);
        const timeOut = new Date(workDate.getTime() + (17 * 60 + outExtra) * 60_000);
        const m = computeEntry(sched, { workDate, timeIn, timeOut, breakMinutes: 60, dayType }, 0);
        await tx.timeEntry.create({
          data: { employeeId: emp.id, workDate, timeIn, timeOut, breakMinutes: 60, dayType, source: 'CLOCK', otApproved: i === 0 && d === -3, ...m },
        });
      }
      if (i === 1) {
        await tx.cashAdvance.create({
          data: { employeeId: emp.id, date: manilaDate(-10), amount: p(2000), installment: p(500), balance: p(2000), reason: 'Tuition of child', createdById: users.admin },
        });
      }
      if (i === 0) {
        await tx.incident.create({
          data: {
            employeeId: emp.id, date: manilaDate(-2), type: 'VIOLATION', severity: 'MINOR', title: 'Repeated tardiness',
            description: 'Late three times within the week (see time records).', actionTaken: 'Verbal warning given.', createdById: users.admin,
          },
        });
      }
    });
  }
  return n;
}

function toDateStr(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function main() {
  console.log('Seeding Paper & Pixels…');
  const users = await seedUsers();
  await seedSettings();
  const suppliers = await seedSuppliers();
  const materials = await seedMaterials(suppliers, users.admin);
  await seedCatalog(materials);
  const expenseCats = await seedExpenseCategories();
  const customers = await seedCustomers();
  const orders = await seedOrders(users, customers);
  await seedExpenses(expenseCats, users.admin);
  const employees = await seedEmployees(users);
  if (employees) console.log(`Added ${employees} sample employees (time-clock PINs 1111, 2222, 3333, 4444).`);

  console.log(`Done: ${Object.keys(users).length} users, ${MATERIALS.length} materials, ${PRODUCTS.length} products, ${CUSTOMERS.length} customers, ${orders} sample orders.`);
  // Tag each material with the product line that uses it (Albums / Picture frames / Printing / Shared).
  const tagged = await prisma.$transaction((tx) => classifyMaterials(tx));
  console.log(`Materials tagged by use: ${tagged.filter((t) => t.usedFor).length}/${tagged.length}`);

  console.log('');
  console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.log('!!  WARNING: default logins  admin / cashier / worker / worker2 / inventory           !!');
  console.log(`!!  all use the password "${DEFAULT_PASSWORD}".                                      !!`);
  console.log('!!  CHANGE THEM right after the first login (My account → Change password,           !!');
  console.log('!!  or Users → Reset password as admin) before using the app with real data.          !!');
  console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
