import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { Player } from '../Player';
import { CHAPTERS, SLIDES } from '../slides';

export const metadata = { title: 'Staff tutorial' };

export default async function StaffTutorialPage({ searchParams }: { searchParams: Promise<{ chapter?: string }> }) {
  await requireUser();
  const { chapter } = await searchParams;
  const start = chapter ? Math.max(0, SLIDES.findIndex((s) => s.chapter === chapter)) : 0;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Staff tutorial — paano gamitin ang system"
        subtitle={`${SLIDES.length} short slides with voice-over. Press ▶ Play and it runs by itself; use ⛶ Fullscreen on a TV.`}
        actions={<Link href="/tutorial" className="btn-secondary">← All tutorials</Link>}
      />
      <div className="overflow-hidden rounded-md border border-slate-800 shadow-lg">
        <Player start={start} slides={SLIDES} chapters={CHAPTERS} />
      </div>
      <p className="text-[12px] text-slate-500">Keyboard: Space = play / pause · ← → = previous / next · F = fullscreen. The voice is English; the on-screen text is Taglish.</p>
    </div>
  );
}
