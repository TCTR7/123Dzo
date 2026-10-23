'use client';
export type SoundStatus = 'OFF' | 'ON' | 'BLOCKED';
let status: SoundStatus = 'OFF', audio: HTMLAudioElement | null = null;
let generation = 0;
const listeners = new Set<() => void>();
function setStatus(next: SoundStatus) { status = next; listeners.forEach(listener => listener()); }
export function soundStatus() { return status; }
export function subscribeSound(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function muteSound() { generation++; audio?.pause(); setStatus('OFF'); }
export function disposeSound() { muteSound(); if (audio) { audio.removeAttribute('src'); audio.load(); audio = null; } }
export async function enableSound(): Promise<boolean> {
  const ownGeneration = ++generation;
  try {
    audio ??= new Audio('/sounds/ting-ting.wav');
    audio.preload = 'auto'; audio.volume = 1; audio.currentTime = 0;
    await audio.play();
    if (ownGeneration !== generation) return false;
    setStatus('ON'); return true;
  } catch { if (ownGeneration === generation) setStatus('BLOCKED'); return false; }
}
export async function playEnabledSound(): Promise<void> {
  if (status !== 'ON' || !audio) return;
  const ownGeneration = generation;
  try { audio.currentTime = 0; await audio.play(); }
  catch { if (ownGeneration === generation) setStatus('BLOCKED'); }
}
