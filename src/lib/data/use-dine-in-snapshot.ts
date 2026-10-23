'use client';
import { useEffect, useRef, useState } from 'react';
import { isRecord } from '@/lib/orders/contracts';
import { parseDineInSnapshot, type DineInSnapshot } from './read-contracts';
import { subscribeInvalidations } from '@/lib/realtime/invalidation';

export function useDineInSnapshot(token: string, onSnapshot: (snapshot: DineInSnapshot) => void) {
  const callback = useRef(onSnapshot);
  callback.current = onSnapshot;
  const [unavailable, setUnavailable] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let stopped = false, inFlight = false, dirty = false;
    let stopLive = () => {};
    let controller: AbortController | null = null;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    setUnavailable(false); setExpired(false);
    if (!navigator.onLine) setUnavailable(true);
    const refresh = async () => {
      if (stopped || document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (inFlight) { dirty = true; return; }
      inFlight = true;
      controller = new AbortController();
      requestTimer = setTimeout(() => controller?.abort(), 12000);
      try {
        const response = await fetch('/api/customer/snapshot', { cache: 'no-store', headers: { 'x-session-token': token }, signal: controller.signal });
        if (stopped || controller.signal.aborted) return;
        if (response.status === 404) { setExpired(true); stopped = true; stopLive(); return; }
        const payload: unknown = await response.json();
        if (stopped || controller.signal.aborted) return;
        const snapshot = response.ok && isRecord(payload) ? parseDineInSnapshot(payload.data, token) : null;
        if (!snapshot) throw new Error('SNAPSHOT_UNAVAILABLE');
        callback.current(snapshot); setUnavailable(!navigator.onLine);
      } catch { if (!stopped) setUnavailable(true); }
      finally {
        clearTimeout(requestTimer); inFlight = false;
        if (dirty && !stopped) { dirty = false; void refresh(); }
      }
    };
    stopLive = subscribeInvalidations({ kind: 'session', token }, () => { void refresh(); });
    const timer = setInterval(() => { void refresh(); }, 10000);
    const onRefresh = () => { void refresh(); };
    const offline = () => setUnavailable(true);
    document.addEventListener('visibilitychange', onRefresh);
    window.addEventListener('online', onRefresh);
    window.addEventListener('focus', onRefresh);
    window.addEventListener('offline', offline);
    return () => {
      stopped = true; stopLive(); controller?.abort(); clearInterval(timer); clearTimeout(requestTimer);
      document.removeEventListener('visibilitychange', onRefresh);
      window.removeEventListener('online', onRefresh);
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener('offline', offline);
    };
  }, [token]);
  return { unavailable, expired };
}
