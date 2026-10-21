import Link from 'next/link';
import { fmtQty, peso } from '@/lib/money';
import { fmtDate, parseDateInput } from '@/lib/dates';
import { Empty, TableWrap } from '@/components/ui';
import type { Column, ReportTable as RT, Row } from './_data';

function cell(col: Column, v: Row[string]) {
  if (v === null || v === undefined || v === '') return col.type === 'text' ? '' : '—';
  switch (col.type) {
    case 'money': return peso(Number(v));
    case 'number': return fmtQty(Number(v));
    case 'date': return fmtDate(parseDateInput(String(v)));
    default: return String(v);
  }
}

const right = (c: Column) => (c.type === 'money' || c.type === 'number' ? 'text-right whitespace-nowrap' : '');

export function ReportTable({ table }: { table: RT }) {
  const { columns, rows, totals } = table;
  if (rows.length === 0) return <Empty>No data for this period.</Empty>;
  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={right(c)}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c, ci) => (
                <td key={c.key} className={`${right(c)} ${c.type === 'money' && Number(r[c.key]) < 0 ? 'text-red-600' : ''}`}>
                  {ci === 0 && r._href ? <Link href={String(r._href)} className="link">{cell(c, r[c.key])}</Link> : cell(c, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              {columns.map((c) => <td key={c.key} className={`px-3 py-2 ${right(c)} ${c.type === 'money' && Number(totals[c.key]) < 0 ? 'text-red-600' : ''}`}>{cell(c, totals[c.key] ?? null)}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </TableWrap>
  );
}
