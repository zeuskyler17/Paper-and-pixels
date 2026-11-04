// Lay Flat albums get two production jobs: the album itself (MAIN) and its pages (PRINT),
// which goes to the Photo Printing board. Pure helpers shared by server pages and client cards.

export type PrintJobItem = { description: string; quantity: number; specs: { name: string; value: string }[] };

/** "Lay Flat 8x20" → "8x20"; null when the product name carries no size. */
export function sizeFromName(name: string): string | null {
  const m = name.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  return m ? `${m[1]}x${m[2]}` : null;
}

/** The print job's name and sheet count: "Lay Flat Print 8x20", "2 albums × 15 leaves = 30 sheets". */
export function printJobInfo(item: PrintJobItem) {
  const size = sizeFromName(item.description);
  const leaves = Number(item.specs.find((s) => /leaves/i.test(s.name))?.value.match(/\d+/)?.[0] ?? 0);
  const sheets = leaves > 0 ? leaves * item.quantity : 0;
  const title = `Lay Flat Print${size ? ` ${size}` : ''}`;
  const detail = leaves > 0
    ? `${item.quantity} album${item.quantity === 1 ? '' : 's'} × ${leaves} leaves = ${sheets} sheets`
    : `${item.quantity} album${item.quantity === 1 ? '' : 's'} — leaves not set`;
  return { title, size, leaves, sheets, detail };
}

/** Card / list title for a job: the product for MAIN, the print job for PRINT. */
export function jobTitle(kind: 'MAIN' | 'PRINT', item: PrintJobItem): string {
  return kind === 'PRINT' ? printJobInfo(item).title : item.description;
}
