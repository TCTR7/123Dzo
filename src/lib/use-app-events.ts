'use client';
import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot } from '@/lib/services/snapshots';
import { playNotificationSound } from '@/lib/utils';

export function useAppEvents(onSnapshot: (snapshot: AppSnapshot) => void, options: { token?: string; enabled?: boolean; sound?: boolean; view?: 'kitchen' | 'staff' } = {}) {
  const callback = useRef(onSnapshot);
  callback.current = onSnapshot;
  const seen = useRef(new Set<string>());
  const [connected, setConnected] = useState(false);
  const [alerts, setAlerts] = useState<AppSnapshot['alerts']>([]);
  useEffect(() => {
    if (options.enabled === false) return;
    const query = new URLSearchParams();
    if (options.token) query.set('token', options.token);
    if (options.view) query.set('view', options.view);
    const source = new EventSource(`/api/events${query.size ? `?${query}` : ''}`);
    source.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as AppSnapshot;
        callback.current(snapshot); setConnected(true); setAlerts(snapshot.alerts);
        const unseen = snapshot.alerts.filter((entry) => !seen.current.has(entry.id));
        snapshot.alerts.forEach((entry) => seen.current.add(entry.id));
        if (options.sound && unseen.length) void playNotificationSound('/sounds/ting-ting.mp3');
      } catch { setConnected(false); }
    };
    source.onerror = () => setConnected(false);
    return () => { source.close(); setConnected(false); };
  }, [options.token, options.enabled, options.sound, options.view]);
  return { connected, alerts };
}
