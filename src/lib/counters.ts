import type { Tx } from './db';
import { manilaYear } from './dates';

export type CounterPrefix = 'PP' | 'AR' | 'PO' | 'PR';

/**
 * Next sequential document number, e.g. PP-2026-00123.
 * MUST be called inside the same transaction that inserts the record: the UPSERT takes a row
 * lock (so numbers are strictly sequential) and is rolled back with the transaction (so a
 * failed save never burns or reuses a number).
 */
export async function nextNumber(tx: Tx, prefix: CounterPrefix): Promise<string> {
  const year = manilaYear();
  const key = `${prefix}-${year}`;
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "counters" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "counters"."value" + 1
    RETURNING "value"`;
  return `${key}-${String(rows[0].value).padStart(5, '0')}`;
}
