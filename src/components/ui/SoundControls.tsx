'use client';
import { useRef, useState, useSyncExternalStore } from 'react';
import { enableSound, muteSound, soundStatus, subscribeSound } from '@/lib/audio/notifications';
export function SoundControls() {
  const status = useSyncExternalStore(subscribeSound, soundStatus, () => 'OFF');
  const lock = useRef(false), [busy, setBusy] = useState(false);
  async function enable() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await enableSound(); } finally { lock.current = false; setBusy(false); }
  }
  return <div className="space-y-1">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void enable()} className="min-h-12 px-4 border border-zinc-700 rounded-xl text-sm disabled:opacity-40">{status === 'ON' ? 'Thử chuông' : 'Bật âm thanh'}</button>
      {status === 'ON' && <button type="button" onClick={muteSound} className="min-h-12 px-4 border border-zinc-700 rounded-xl text-sm">Tắt âm thanh</button>}
    </div>
    <p role="status" className="text-xs text-zinc-400">{status === 'BLOCKED' ? 'Trình duyệt chưa cho phát âm thanh. Chạm Bật âm thanh để thử lại.' : status === 'ON' ? 'Chuông đang bật khi mở ứng dụng.' : 'Chuông đang tắt. Chạm để bật trong lần mở này.'}</p>
  </div>;
}
