'use client';
import { useEffect } from 'react';

export function AppServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/app-sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}
