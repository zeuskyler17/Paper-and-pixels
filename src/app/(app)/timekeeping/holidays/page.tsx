import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fmtDate, manilaYear, parseDateInput, toDateInput } from '@/lib/dates';
import { HOLIDAY_TYPE, options } from '@/lib/labels';
import { Badge, Card, Empty, Field, PageHeader, Select, TableWrap } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { weekdayShort } from '../_dtr';
import { createHoliday, deleteHoliday, seedPhHolidays2026, updateHoliday } from '../actions';

export const metadata = { title: 'Holidays' };

type SP = Promise<{ year?: string; edit?: string }>;

export default async function HolidaysPage({ searchParams }: { searchParams: SP }) {
  await requireUser('hr');
  const sp = await searchParams;
  const y = Number(sp.year);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : manilaYear();
  const editId = Number(sp.edit) || 0;
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: parseDateInput(`${year}-01-01`)!, lt: parseDateInput(`${year + 1}-01-01`)! } },
    orderBy: { date: 'asc' },
  });
  const editing = holidays.find((h) => h.id === editId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Holidays"
        subtitle="Holiday calendar used for day types, holiday pay and premiums"
        actions={<Link href="/timekeeping" className="btn-secondary">← Timekeeping</Link>}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card
          title={`${year} holidays (${holidays.length})`}
          actions={
            <div className="flex gap-1">
              <Link href={`/timekeeping/holidays?year=${year - 1}`} className="btn-secondary btn-sm">← {year - 1}</Link>
              <Link href={`/timekeeping/holidays?year=${year + 1}`} className="btn-secondary btn-sm">{year + 1} →</Link>
            </div>
          }
        >
          {holidays.length === 0 ? <Empty>No holidays recorded for {year}.</Empty> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th /></tr></thead>
                <tbody>
                  {holidays.map((h) => (
                    <tr key={h.id} className={h.id === editId ? 'bg-brand-50' : ''}>
                      <td className="whitespace-nowrap"><span className="num">{fmtDate(h.date)}</span> <span className="text-slate-500">{weekdayShort(toDateInput(h.date))}</span></td>
                      <td>{h.name}</td>
                      <td><Badge tone={h.type === 'REGULAR' ? 'purple' : 'blue'}>{h.type === 'REGULAR' ? 'Regular' : 'Special'}</Badge></td>
                      <td className="whitespace-nowrap text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/timekeeping/holidays?year=${year}&edit=${h.id}`} className="btn-secondary btn-sm">Edit</Link>
                          <ActionForm action={deleteHoliday.bind(null, h.id)} confirm={`Delete ${h.name}? Time records on that date go back to regular / rest day.`}>
                            <SubmitButton className="btn-secondary btn-sm">Delete</SubmitButton>
                          </ActionForm>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <div className="space-y-5">
          {editing ? (
            <Card title="Edit holiday" actions={<Link href={`/timekeeping/holidays?year=${year}`} className="link text-[12px]">Cancel</Link>}>
              <ActionForm key={editing.id} action={updateHoliday.bind(null, editing.id)} className="grid gap-3">
                <HolidayFields date={toDateInput(editing.date)} name={editing.name} type={editing.type} />
                <SubmitButton>Save holiday</SubmitButton>
              </ActionForm>
            </Card>
          ) : (
            <Card title="Add holiday">
              <ActionForm action={createHoliday} resetOnSuccess className="grid gap-3">
                <HolidayFields />
                <SubmitButton>Add holiday</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title="Philippine holidays 2026">
            <ActionForm action={seedPhHolidays2026} className="space-y-2" confirm="Add the common 2026 Philippine holidays? Dates that already have a holiday are skipped.">
              <p className="text-[12.5px] text-slate-600">
                Adds the fixed-date regular holidays and special non-working days for 2026 (existing dates are skipped).
              </p>
              <SubmitButton className="btn-secondary">Add 2026 Philippine holidays</SubmitButton>
            </ActionForm>
            <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              Verify against the official proclamation each year; Eid holidays and special declarations must be added manually.
            </p>
          </Card>

          <p className="text-[12px] text-slate-500">
            Adding, changing or deleting a holiday updates the day type of existing time records on that date
            (except paid leave and days inside a finalized or paid payroll).
          </p>
        </div>
      </div>
    </div>
  );
}

function HolidayFields({ date, name, type }: { date?: string; name?: string; type?: string }) {
  return (
    <>
      <Field label="Date"><input type="date" name="date" required defaultValue={date} className="input" /></Field>
      <Field label="Name"><input name="name" required defaultValue={name} className="input" placeholder="e.g. Pangasinan Day" /></Field>
      <Field label="Type"><Select name="type" options={options(HOLIDAY_TYPE)} defaultValue={type ?? 'REGULAR'} required /></Field>
    </>
  );
}
