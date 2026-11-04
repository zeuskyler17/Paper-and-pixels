// Copy every branch's data from this Mac's database into Supabase (one schema per branch). Run through
// ./scripts/cloud-setup.sh copy — it loads the connection strings. Read-only on this Mac; refuses to copy into a
// Supabase schema that already holds data, so it can never double anything up.
import { PrismaClient } from '@prisma/client';

const CLOUD = process.env.SUPABASE_URL;
const BRANCHES: { name: string; from: string | undefined; schema: string }[] = [
  { name: 'Paper & Pixels', from: process.env.DATABASE_URL, schema: 'public' },
  { name: 'Keoni', from: process.env.DATABASE_URL_KEONI, schema: 'keoni' },
  { name: 'Ky', from: process.env.DATABASE_URL_KY, schema: 'ky' },
];
const BATCH = 2000;
/** Tables the migrations fill with defaults (INSERT INTO in prisma/migrations); replaced by this Mac's rows. */
const SEEDED = new Set(['roles']);
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function tables(db: PrismaClient, schema: string) {
  const rows = await db.$queryRaw<{ t: string }[]>`
    SELECT tablename AS t FROM pg_tables WHERE schemaname = ${schema} AND tablename <> '_prisma_migrations' ORDER BY 1`;
  return rows.map((r) => r.t);
}
async function count(db: PrismaClient, schema: string, table: string) {
  const [r] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${q(schema)}.${q(table)}`);
  return Number(r.n);
}

async function copyBranch(b: (typeof BRANCHES)[number], cloud: PrismaClient) {
  if (!b.from) { console.log(`${b.name}: no local database configured, skipped`); return; }
  const src = new PrismaClient({ datasourceUrl: b.from });
  try {
    const list = await tables(src, 'public');
    const missing = (await tables(cloud, b.schema)).length === 0;
    if (missing) throw new Error(`${b.name}: schema "${b.schema}" has no tables in Supabase — run ./scripts/cloud-setup.sh db first.`);
    for (const t of list) {
      if (SEEDED.has(t)) continue;
      if ((await count(cloud, b.schema, t)) > 0) throw new Error(`${b.name}: Supabase table ${b.schema}.${t} already has data — not copying (nothing was changed).`);
    }
    const counts: Record<string, number> = {};
    await cloud.$transaction(async (tx) => {
      // Load rows without foreign-key checks (tables are copied whole, so every reference ends up valid).
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      for (const t of list) if (SEEDED.has(t)) await tx.$executeRawUnsafe(`DELETE FROM ${q(b.schema)}.${q(t)}`);
      for (const t of list) {
        let n = 0;
        for (let off = 0; ; off += BATCH) {
          const [r] = await src.$queryRawUnsafe<{ j: unknown[] | null }[]>(
            `SELECT jsonb_agg(to_jsonb(x)) AS j FROM (SELECT * FROM "public".${q(t)} ORDER BY 1 LIMIT ${BATCH} OFFSET ${off}) x`);
          const rows = r.j ?? [];
          if (rows.length === 0) break;
          await tx.$executeRawUnsafe(
            `INSERT INTO ${q(b.schema)}.${q(t)} SELECT * FROM jsonb_populate_recordset(NULL::${q(b.schema)}.${q(t)}, $1::jsonb)`,
            JSON.stringify(rows));
          n += rows.length;
          if (rows.length < BATCH) break;
        }
        counts[t] = n;
      }
      // Move each id counter past the copied rows so new records get fresh numbers.
      const seqs = await tx.$queryRaw<{ t: string; c: string }[]>`
        SELECT table_name AS t, column_name AS c FROM information_schema.columns
        WHERE table_schema = ${b.schema} AND column_default LIKE 'nextval(%'`;
      for (const s of seqs) {
        await tx.$queryRawUnsafe(
          `SELECT setval(pg_get_serial_sequence('${q(b.schema)}.${q(s.t)}', '${s.c}'), coalesce(max(${q(s.c)}), 1), max(${q(s.c)}) IS NOT NULL) FROM ${q(b.schema)}.${q(s.t)}`);
      }
    }, { timeout: 30 * 60_000, maxWait: 60_000 });

    // Check: every table has the same number of rows on both sides.
    let bad = 0;
    for (const t of list) {
      const [a, c] = [await count(src, 'public', t), await count(cloud, b.schema, t)];
      if (a !== c) { bad++; console.log(`  MISMATCH ${t}: Mac ${a}, Supabase ${c}`); }
    }
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    console.log(`${b.name}: copied ${total} rows in ${list.length} tables${bad ? `, ${bad} MISMATCHES` : ', all counts match'}`);
    if (bad) process.exitCode = 1;
  } finally {
    await src.$disconnect();
  }
}

async function main() {
  if (!CLOUD) throw new Error('SUPABASE_URL is not set — run through ./scripts/cloud-setup.sh copy');
  const cloud = new PrismaClient({ datasourceUrl: CLOUD });
  try {
    for (const b of BRANCHES) await copyBranch(b, cloud);
  } finally {
    await cloud.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
