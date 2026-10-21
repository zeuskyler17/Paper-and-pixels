import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { CHAPTERS, OWNER_CHAPTERS, OWNER_SLIDES, SLIDES, type Chapter, type Slide } from './slides';

export const metadata = { title: 'Tutorial' };

/** ~ minutes of narration: the voice reads about 150 words a minute, plus a pause per slide. */
function minutes(slides: Slide[]) {
  const words = slides.reduce((n, s) => n + s.say.split(/\s+/).length, 0);
  return Math.max(1, Math.round(words / 150 + slides.length * 0.02));
}

function TutorialCard({ href, image, title, who, slides, chapters, tone }: {
  href: string; image: string; title: string; who: string; slides: Slide[]; chapters: Chapter[]; tone: 'blue' | 'amber';
}) {
  const ring = tone === 'blue' ? 'ring-brand-600' : 'ring-amber-500';
  const badge = tone === 'blue' ? 'bg-brand-600' : 'bg-amber-500 text-slate-900';
  return (
    <Link href={href} className="group card block overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-lg">
      {/* thumbnail: a real screenshot, cropped, with a play button */}
      <div className="relative aspect-[16/9] overflow-hidden bg-slate-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/tutorial/${image}`} alt="" className="absolute inset-0 h-full w-full object-cover object-top opacity-90 transition group-hover:scale-[1.03] group-hover:opacity-100" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent" />
        <div className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-[26px] text-slate-900 shadow-xl ring-4 ring-white/30 transition group-hover:scale-110">▶</div>
        <div className={`absolute left-3 top-3 rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white ${badge}`}>{who}</div>
        <div className="absolute bottom-3 left-4 right-4 text-white">
          <div className="text-[20px] font-semibold leading-tight">{title}</div>
          <div className="text-[12.5px] opacity-85">{slides.length} slides · about {minutes(slides)} min · voice-over</div>
        </div>
      </div>
      <div className={`border-t-4 px-4 py-3 ${ring.replace('ring-', 'border-')}`}>
        <ol className="grid gap-1 text-[13px] text-slate-700 sm:grid-cols-2">
          {chapters.slice(1).map((c, i) => <li key={c.key}><span className="mr-1.5 font-mono text-[11px] text-slate-400">{i + 1}.</span>{c.label}</li>)}
        </ol>
      </div>
    </Link>
  );
}

export default async function TutorialHub({ searchParams }: { searchParams: Promise<{ chapter?: string }> }) {
  const user = await requireUser();
  const { chapter } = await searchParams;
  // Old links (/tutorial?chapter=worker) still work.
  if (chapter) redirect(`/tutorial/staff?chapter=${encodeURIComponent(chapter)}`);

  return (
    <div className="space-y-4">
      <PageHeader title="Tutorials" subtitle="Narrated walkthroughs of the system. Press a thumbnail to play; use Fullscreen on a TV." />
      <div className={`grid gap-4 ${user.isAdmin ? 'lg:grid-cols-2' : 'max-w-2xl'}`}>
        <TutorialCard href="/tutorial/staff" image="my-jobs.jpg" title="Staff tutorial" who="Para sa lahat" slides={SLIDES} chapters={CHAPTERS} tone="blue" />
        {user.isAdmin && (
          <TutorialCard href="/tutorial/owner" image="dashboard-pnl.jpg" title="Owner / admin tutorial" who="Admin only" slides={OWNER_SLIDES} chapters={OWNER_CHAPTERS} tone="amber" />
        )}
      </div>
      <p className="text-[12px] text-slate-500">Taglish on screen, English voice. Send staff a direct link to a chapter, e.g. <code>/tutorial/staff?chapter=worker</code>.</p>
    </div>
  );
}
