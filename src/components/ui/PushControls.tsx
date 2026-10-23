'use client';
import { useEffect, useRef, useState } from 'react';
import { disableDevicePush, enableDevicePush, supportsDevicePush } from '@/lib/pwa/push-device';
export function PushControls({ userId }: { userId: string }) {
  const lock = useRef(false), [busy, setBusy] = useState(false), [registered, setRegistered] = useState(false);
  const [supported, setSupported] = useState(true), [message, setMessage] = useState<string | null>(null);
  const actor = useRef(userId); actor.current = userId;
  useEffect(() => { setSupported(supportsDevicePush()); setRegistered(false); setMessage(null); }, [userId]);
  async function run(enable: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(null);
    const requestedActor = userId;
    try {
      if (enable) {
        await enableDevicePush(userId);
        if (actor.current === requestedActor) { setRegistered(true); setMessage('Quán đã xác nhận đăng ký thiết bị này.'); }
      } else {
        const confirmed = await disableDevicePush(userId);
        if (actor.current === requestedActor) { setRegistered(false); setMessage(confirmed ? 'Đã tắt thông báo trên thiết bị này.' : 'Đã tắt trên máy; chưa xác nhận gỡ tại quán. Chạm Tắt để thử đối soát lại.'); }
      }
    } catch (error) { if (actor.current === requestedActor) setMessage(error instanceof Error && /[À-ỹ]/.test(error.message) ? error.message : 'Chưa xác nhận được thay đổi thông báo. Hãy kiểm tra kết nối hoặc quyền trình duyệt rồi thử lại.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="space-y-2 text-sm">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !supported} onClick={() => void run(true)} className="min-h-12 px-4 rounded-xl border border-zinc-700 disabled:opacity-40">{registered ? 'Đăng ký lại thông báo' : 'Bật / đăng ký lại thông báo'}</button>
      <button type="button" disabled={busy || !supported} onClick={() => void run(false)} className="min-h-12 px-4 rounded-xl border border-zinc-700 disabled:opacity-40">Tắt thông báo trên máy</button>
    </div>
    <p className="text-xs text-zinc-400">Mỗi tài khoản nhận push trên một thiết bị. Bật ở máy khác sẽ thay máy nhận trước đó. Trên iPhone/iPad, thêm ứng dụng vào Màn hình chính rồi mở từ đó.</p>
    {!supported && <p role="status" className="text-amber-300 text-xs">Thiết bị hoặc trình duyệt này chưa hỗ trợ push. Hãy giữ màn hình Phục vụ mở để xem công việc.</p>}
    {message && <p role="status" className="text-xs text-amber-300">{message}</p>}
  </div>;
}
