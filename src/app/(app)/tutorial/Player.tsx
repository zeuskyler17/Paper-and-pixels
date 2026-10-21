'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chapter, Slide } from './slides';

/** Auto-playing narrated slideshow of the app. Audio is pre-rendered (public/tutorial/audio). */
export function Player({ start = 0, slides: SLIDES, chapters: CHAPTERS }: { start?: number; slides: Slide[]; chapters: Chapter[] }) {
  const [i, setI] = useState(() => Math.min(Math.max(0, start), SLIDES.length - 1));
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 within the current slide
  // "Fill the window" mode: used when real fullscreen is unavailable (iPhone Safari, embedded browsers) or refused.
  const [fill, setFill] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slide = SLIDES[i];
  const chapterIdx = CHAPTERS.findIndex((c) => c.key === slide.chapter);
  const firstOf = useMemo(() => Object.fromEntries(CHAPTERS.map((c) => [c.key, SLIDES.findIndex((s) => s.chapter === c.key)])), [CHAPTERS, SLIDES]);

  const go = useCallback((n: number) => { setI(Math.min(Math.max(0, n), SLIDES.length - 1)); setProgress(0); }, []);
  const next = useCallback(() => { if (i < SLIDES.length - 1) go(i + 1); else setPlaying(false); }, [i, go]);

  // Play the slide's narration whenever the slide changes while playing; advance when it ends.
  useEffect(() => {
    const a = audio.current;
    if (timer.current) clearTimeout(timer.current);
    if (!a) return;
    a.pause();
    a.currentTime = 0;
    if (!playing) return;
    const fallbackMs = Math.max(7000, slide.say.split(' ').length * 420);
    const advance = () => { timer.current = setTimeout(next, 900); };
    const onEnd = () => advance();
    a.addEventListener('ended', onEnd);
    a.muted = muted;
    a.play().catch(() => { timer.current = setTimeout(next, fallbackMs); });
    return () => { a.removeEventListener('ended', onEnd); if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, playing]);

  useEffect(() => { if (audio.current) audio.current.muted = muted; }, [muted]);

  // Fullscreen: try the real thing (desktop browsers), otherwise fill the browser window.
  const toggleFull = useCallback(async () => {
    const el = box.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | null;
    const doc = document as Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element | null };
    if (document.fullscreenElement || doc.webkitFullscreenElement) { (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document); return; }
    if (fill) { setFill(false); return; }
    // Some browsers (iPhone Safari, embedded web views, kiosk apps) refuse, or never answer, the request.
    // Whatever happens, if we are not really fullscreen after a moment, fill the window instead.
    try {
      const req = el?.requestFullscreen ? el.requestFullscreen() : el?.webkitRequestFullscreen?.();
      await Promise.race([Promise.resolve(req).catch(() => undefined), new Promise((r) => setTimeout(r, 700))]);
    } catch { /* fall through */ }
    if (!document.fullscreenElement && !doc.webkitFullscreenElement) setFill(true);
  }, [fill]);
  useEffect(() => {
    const sync = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    if (!fill) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setFill(false); };
    window.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onEsc); document.body.style.overflow = ''; };
  }, [fill]);

  // Keyboard: space play/pause, arrows prev/next, F fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
      else if (e.key.toLowerCase() === 'f') void toggleFull();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, go, toggleFull]);

  const onTime = () => { const a = audio.current; if (a && a.duration) setProgress(a.currentTime / a.duration); };

  return (
    <div ref={box} className={`flex flex-col bg-slate-950 text-white ${fill ? 'fixed inset-0 z-[100] h-[100dvh]' : 'min-h-[70vh]'} ${isFs ? 'h-screen' : ''}`}>
      <audio ref={audio} src={`/tutorial/audio/${slide.id}.m4a`} preload="auto" onTimeUpdate={onTime} />

      {/* stage */}
      <div className="grid flex-1 gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="relative min-h-[46vh] overflow-hidden bg-slate-900 lg:min-h-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={slide.id} src={`/tutorial/${slide.image}`} alt={slide.title}
            className={`absolute inset-0 h-full w-full object-cover object-top ${playing ? 'animate-[tutpan_16s_ease-in-out_infinite_alternate]' : ''}`} />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/80 to-transparent" />
          <div className="absolute left-4 top-4 rounded bg-black/55 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-200">
            {CHAPTERS[chapterIdx]?.label} · {i + 1} / {SLIDES.length}
          </div>
        </div>
        <div className="flex flex-col justify-center gap-5 px-6 py-8 lg:px-10">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-200">{CHAPTERS[chapterIdx]?.who}</div>
          <h2 className="text-[26px] font-semibold leading-tight text-white sm:text-[32px]">{slide.title}</h2>
          <p className="text-[18px] leading-relaxed text-slate-100 sm:text-[21px]" style={{ color: '#f1f5f9' }}>{slide.caption}</p>
          <div className="h-1.5 w-full overflow-hidden rounded bg-white/15"><div className="h-full bg-brand-500 transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        </div>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-slate-950 px-4 py-3">
        <button type="button" onClick={() => go(i - 1)} disabled={i === 0} className="rounded border border-white/20 px-3 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-40">◀ Prev</button>
        <button type="button" onClick={() => setPlaying((p) => !p)} className="rounded bg-brand-600 px-5 py-2 text-sm font-semibold hover:bg-brand-500">{playing ? '❚❚ Pause' : i === SLIDES.length - 1 && !playing && progress >= 0.99 ? '↻ Replay' : '▶ Play'}</button>
        <button type="button" onClick={() => go(i + 1)} disabled={i === SLIDES.length - 1} className="rounded border border-white/20 px-3 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-40">Next ▶</button>
        <button type="button" onClick={() => setMuted((m) => !m)} className="rounded border border-white/20 px-3 py-2 text-sm hover:bg-white/10" title="Voice on / off">{muted ? '🔇 Voice off' : '🔊 Voice on'}</button>
        <button type="button" onClick={() => void toggleFull()} className="rounded border border-white/20 px-3 py-2 text-sm hover:bg-white/10" title="Fullscreen (F) — Esc to exit">{fill || isFs ? '✕ Exit fullscreen' : '⛶ Fullscreen'}</button>
        <div className="ml-auto flex flex-wrap gap-1">
          {CHAPTERS.map((c, k) => (
            <button key={c.key} type="button" onClick={() => go(firstOf[c.key])}
              className={`rounded px-2.5 py-1.5 text-[12px] font-semibold ${k === chapterIdx ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10'}`}>{k === 0 ? c.label : `${k}. ${c.label}`}</button>
          ))}
        </div>
      </div>
      <style>{`@keyframes tutpan { from { object-position: 50% 0%; } to { object-position: 50% 100%; } }`}</style>
    </div>
  );
}
