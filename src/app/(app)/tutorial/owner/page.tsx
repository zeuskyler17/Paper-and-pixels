import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { Player } from '../Player';
import { OWNER_CHAPTERS, OWNER_SLIDES } from '../slides';

export const metadata = { title: 'Owner tutorial' };

/** Owner / admin walkthrough: money, people and setup. Admin role only. */
export default async function OwnerTutorialPage({ searchParams }: { searchParams: Promise<{ chapter?: string }> }) {
  await requireUser('admin');
  const { chapter } = await searchParams;
  const start = chapter ? Math.max(0, OWNER_SLIDES.findIndex((s) => s.chapter === chapter)) : 0;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Owner / admin tutorial"
        subtitle={`${OWNER_SLIDES.length} slides, admin only: ${OWNER_CHAPTERS.slice(1).map((c) => c.label).join(' · ')}.`}
        actions={<Link href="/tutorial" className="btn-secondary">← All tutorials</Link>}
      />
      <div className="overflow-hidden rounded-md border border-slate-800 shadow-lg">
        <Player start={start} slides={OWNER_SLIDES} chapters={OWNER_CHAPTERS} />
      </div>
      <p className="text-[12px] text-slate-500">Keyboard: Space = play / pause · ← → = previous / next · F = fullscreen.</p>
    </div>
  );
}
