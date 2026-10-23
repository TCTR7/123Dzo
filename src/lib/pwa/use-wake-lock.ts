'use client';
import { useEffect, useState } from 'react';
export function useScreenWakeLock() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let disposed = false, pending = false, lock: WakeLockSentinel | null = null;
    const release = () => {
      const current = lock; lock = null;
      if (!disposed) setActive(false);
      if (current && !current.released) void current.release().catch(() => undefined);
    };
    const acquire = async () => {
      if (disposed || pending || lock && !lock.released || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (disposed || document.visibilityState !== 'visible') { await next.release(); return; }
        lock = next; setActive(!next.released);
        next.addEventListener('release', () => { if (lock === next) { lock = null; if (!disposed) setActive(false); } }, { once: true });
      } catch { if (!disposed) setActive(false); }
      finally { pending = false; }
    };
    const visibility = () => { if (document.visibilityState === 'visible') void acquire(); else release(); };
    void acquire(); document.addEventListener('visibilitychange', visibility);
    return () => { disposed = true; document.removeEventListener('visibilitychange', visibility); release(); };
  }, []);
  return active;
}
