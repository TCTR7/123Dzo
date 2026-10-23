'use client';
import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeInvalidations } from '@/lib/realtime/invalidation';

/** Private invalidation plus guarded polling recovery. */
export function useServerRefresh(intervalMs = 15000, actor?: string | null) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(pending), dirty = useRef(false);
  pendingRef.current = pending;
  useEffect(() => {
    if (!pending && dirty.current && document.visibilityState === 'visible' && navigator.onLine) {
      dirty.current = false; startTransition(() => router.refresh());
    }
  }, [pending, router]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (pendingRef.current) { dirty.current = true; return; }
      dirty.current = false;
      startTransition(() => router.refresh());
    };
    const timer = setInterval(refresh, intervalMs);
    const stopLive = actor ? subscribeInvalidations({ kind: 'staff', actor }, refresh) : () => {};
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      stopLive(); dirty.current = false;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [router, intervalMs, actor]);
}
