import type { Settings } from '@/lib/settings';
import { getBranch } from '@/lib/auth';
import { initials } from '@/lib/branches';

/**
 * Compact, all-black letterhead for printed documents (order slip, receipts, delivery slips, POs).
 * The logo is printed in pure black/grey so it looks the same on any printer.
 */
export function PrintHeader({ s, title, docNo, date, badge, copy }: {
  s: Pick<Settings, 'shop_name' | 'shop_address' | 'shop_contact' | 'shop_email' | 'shop_facebook'>;
  title: string; docNo: string; date?: string; badge?: string | null; copy?: string | null;
}) {
  const contact = [s.shop_contact, s.shop_email, s.shop_facebook ? `FB: ${s.shop_facebook}` : ''].filter(Boolean).join(' · ');
  const logo = getBranch()?.logo ?? null;
  return (
    <header className="flex items-start justify-between gap-3 border-b-2 border-black pb-1.5 text-black">
      <div className="flex min-w-0 items-center gap-2">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" width={34} height={34} className="h-[34px] w-[34px] shrink-0" style={{ filter: 'grayscale(1) contrast(1.6) brightness(0.75)' }} />
        ) : (
          <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full border-2 border-black text-[12px] font-black">{initials(s.shop_name)}</span>
        )}
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-bold">{s.shop_name}</div>
          <div className="text-[9.5px]">{s.shop_address}</div>
          {contact && <div className="text-[9.5px]">{contact}</div>}
        </div>
      </div>
      <div className="shrink-0 text-right leading-tight">
        <div className="text-[9.5px] font-bold uppercase tracking-wide">{title}</div>
        <div className="text-[13px] font-bold">{docNo}</div>
        {date && <div className="text-[9.5px]">{date}</div>}
        {copy && <div className="mt-0.5 inline-block border border-black px-1 text-[8.5px] font-bold uppercase tracking-wide">{copy}</div>}
        {badge && <div className="mt-0.5 inline-block border-2 border-black px-1 text-[10px] font-bold">{badge}</div>}
      </div>
    </header>
  );
}
