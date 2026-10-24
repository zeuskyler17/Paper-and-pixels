import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getUser } from '@/lib/auth';
import { todayManila } from '@/lib/dates';
import { buildReport, canSeeReport, isReportKey, normalizeParams, type Column, type ReportData, type ReportTable, type Row } from '@/app/(app)/reports/_data';

/** Export value: money in pesos (2 dp number), dates as YYYY-MM-DD, numbers as-is. */
function exportValue(col: Column, v: Row[string] | undefined): string | number | null {
  if (v === null || v === undefined || v === '') return null;
  if (col.type === 'money') return Math.round(Number(v)) / 100;
  if (col.type === 'number') return Number(v);
  return String(v);
}

function csvCell(v: string | number | null): string {
  if (v === null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function moneyCsv(col: Column, v: string | number | null) {
  return col.type === 'money' && typeof v === 'number' ? v.toFixed(2) : csvCell(v);
}

function tableCsv(t: ReportTable): string[] {
  const lines: string[] = [];
  if (t.title) lines.push(csvCell(t.title));
  lines.push(t.columns.map((c) => csvCell(c.label)).join(','));
  const line = (r: Row) => t.columns.map((c) => moneyCsv(c, exportValue(c, r[c.key]))).join(',');
  for (const r of t.rows) lines.push(line(r));
  if (t.totals) lines.push(line(t.totals));
  return lines;
}

function toCsv(data: ReportData): string {
  const lines = [csvCell(data.title), csvCell(data.period), '', ...tableCsv(data)];
  for (const t of data.extra ?? []) lines.push('', ...tableCsv(t));
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads ₱/UTF-8 correctly
}

function addSheet(wb: ExcelJS.Workbook, name: string, t: ReportTable, header: string[]) {
  const ws = wb.addWorksheet(name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  for (const h of header) ws.addRow([h]).font = { bold: true };
  if (header.length) ws.addRow([]);
  const headRow = ws.addRow(t.columns.map((c) => c.label));
  headRow.font = { bold: true };
  headRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; });

  const write = (r: Row, bold = false) => {
    const row = ws.addRow(t.columns.map((c) => {
      const v = exportValue(c, r[c.key]);
      if (c.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
      return v;
    }));
    if (bold) row.font = { bold: true };
  };
  for (const r of t.rows) write(r);
  if (t.totals) write(t.totals, true);

  t.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'money') col.numFmt = '#,##0.00';
    else if (c.type === 'date') col.numFmt = 'yyyy-mm-dd';
    else if (c.type === 'number') col.numFmt = '#,##0.###';
    const longest = Math.max(c.label.length, ...t.rows.map((r) => String(r[c.key] ?? '').length));
    col.width = Math.min(60, Math.max(10, longest + 2));
  });
}

async function toXlsx(data: ReportData): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Paper & Pixels';
  wb.created = new Date();
  addSheet(wb, data.title, data, [data.title, data.period]);
  (data.extra ?? []).forEach((t, i) => addSheet(wb, t.title ?? `Table ${i + 2}`, t, [t.title ?? '', data.period]));
  if (data.notes?.length) {
    const ws = wb.addWorksheet('Notes');
    ws.getColumn(1).width = 120;
    for (const n of data.notes) ws.addRow([n]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const user = await getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  const { report } = await params;
  if (!isReportKey(report)) return new NextResponse('Unknown report', { status: 404 });
  if (!canSeeReport(user, report)) return new NextResponse('Forbidden', { status: 403 });

  const url = new URL(req.url);
  const p = normalizeParams({ from: url.searchParams.get('from'), to: url.searchParams.get('to'), group: url.searchParams.get('group') });
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const data = await buildReport(report, p, user.isAdmin);
  const base = `${report}_${report === 'receivables' ? `as-of-${todayManila()}` : report === 'daily' ? p.to : `${p.from}_to_${p.to}`}`;

  if (format === 'csv') {
    return new NextResponse(toCsv(data), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return new NextResponse(await toXlsx(data), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${base}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
