'use client';
import { useEffect, useRef } from 'react';
import { playEnabledSound } from '@/lib/audio/notifications';

/** Signal only newly observed state entries; mounting a screen is silent. */
export function useSnapshotSound(ids: string[]) {
  const previous = useRef(new Set(ids));
  useEffect(() => {
    if (ids.some(id => !previous.current.has(id))) void playEnabledSound();
    previous.current = new Set(ids);
  }, [ids]);
}
