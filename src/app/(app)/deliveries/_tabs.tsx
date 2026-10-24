import Link from 'next/link';

/** Deliveries section tabs: delivery / pickup records, and orders released to the customer. */
export function DeliveryTabs({ active }: { active: 'records' | 'released' }) {
  const tab = (key: 'records' | 'released', href: string, label: string) => (
    <Link href={href} className={`border-b-2 px-3 py-2 text-sm font-semibold ${active === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</Link>
  );
  return (
    <nav className="mb-4 flex gap-1 border-b border-slate-200">
      {tab('records', '/deliveries', 'Deliveries & pickups')}
      {tab('released', '/deliveries/released', 'Released / Delivered orders')}
    </nav>
  );
}
