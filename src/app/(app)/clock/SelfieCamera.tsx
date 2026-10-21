'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

export type SelfieHandle = {
  /** Grab the current frame as a JPEG data URL, or null if the camera isn't ready. */
  capture: () => string | null;
};
export type CameraState = 'starting' | 'ready' | 'blocked' | 'unavailable' | 'insecure';

const WIDTH = 480; // output width; ~30–60 KB per JPEG

/**
 * Front-camera preview for the time clock. The photo is taken by the parent at the moment the
 * employee presses Enter (capture()), so a photo taken earlier can't be reused.
 */
export function SelfieCamera({ ref, onState }: { ref: Ref<SelfieHandle>; onState?: (s: CameraState) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>('starting');

  useEffect(() => { onState?.(state); }, [state, onState]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (typeof window !== 'undefined' && !window.isSecureContext) { setState('insecure'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setState('unavailable'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => {});
        }
        setState('ready');
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : 'unavailable');
      }
    })();
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  useImperativeHandle(ref, () => ({
    capture() {
      const v = video.current;
      if (!v || state !== 'ready' || !v.videoWidth) return null;
      const scale = WIDTH / v.videoWidth;
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = Math.round(v.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // Mirror like the preview so the saved photo matches what the employee saw.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.72);
    },
  }), [state]);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-graphite-900">
      <video ref={video} playsInline muted autoPlay className="h-full w-full scale-x-[-1] object-cover" />
      {state === 'ready' && (
        <>
          {/* face guide */}
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[70%] w-[45%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-white/60" />
          <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Camera on
          </div>
        </>
      )}
      {state !== 'ready' && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-[13px] text-slate-200">
          {state === 'starting' && 'Starting camera…'}
          {state === 'blocked' && (
            <span>
              <b className="block text-[14px] text-white">Camera access is blocked.</b>
              Allow the camera for this site (tap the lock / camera icon in the address bar → Allow), then reopen your name.
            </span>
          )}
          {state === 'unavailable' && (
            <span><b className="block text-[14px] text-white">No camera found.</b>Connect a webcam or use a phone/tablet with a front camera.</span>
          )}
          {state === 'insecure' && (
            <span><b className="block text-[14px] text-white">Camera needs a secure connection.</b>Open the app through its https:// address (the online version), not a local IP address.</span>
          )}
        </div>
      )}
    </div>
  );
}
