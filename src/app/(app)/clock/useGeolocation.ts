'use client';

import { useEffect, useRef, useState } from 'react';
import type { GeoFix } from '@/lib/geo';

export type GeoState = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';

/**
 * Watches the device position while `active` and keeps the most accurate recent fix.
 * The fix is read at the moment of the punch, like the selfie.
 */
export function useGeolocation(active: boolean): { fix: GeoFix | null; state: GeoState } {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [state, setState] = useState<GeoState>('idle');
  const best = useRef<{ fix: GeoFix; at: number } | null>(null);

  useEffect(() => {
    if (!active) { best.current = null; setFix(null); setState('idle'); return; }
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setState('unavailable'); return; }
    setState('locating');
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const f: GeoFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null };
        const now = Date.now();
        // Prefer a more accurate fix, unless the one we have is older than 30 s.
        const keep = best.current && now - best.current.at < 30_000 && best.current.fix.accuracy != null && f.accuracy != null && best.current.fix.accuracy < f.accuracy;
        if (!keep) best.current = { fix: f, at: now };
        setFix(best.current!.fix);
        setState('ready');
      },
      (err) => { if (!best.current) setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'); },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  return { fix, state };
}
