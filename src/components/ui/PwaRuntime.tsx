'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { registerPwa } from '@/lib/pwa/registration';
import { reconcilePushOwner } from '@/lib/pwa/push-device';
import { disposeSound } from '@/lib/audio/notifications';
import { setRealtimeActor } from '@/lib/realtime/invalidation';
export function PwaRuntime() {
  const { isLoaded, user } = useUser();
  const [warning, setWarning] = useState(false);
  useEffect(() => {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
    void registerPwa().catch(() => { /* push controls report registration failure when used */ });
  }, []);
  useEffect(() => {
    if (!isLoaded) return;
    let active = true;
    setRealtimeActor(user?.id ?? null);
    disposeSound();
    void reconcilePushOwner(user?.id ?? null).then(() => { if (active) setWarning(false); }).catch(() => { if (active) setWarning(true); });
    return () => { active = false; disposeSound(); setRealtimeActor(null); };
  }, [isLoaded, user?.id]);
  return warning ? <p role="alert" className="p-3 bg-amber-950 text-amber-200 text-sm">Chưa kiểm tra được đăng ký thông báo cũ trên thiết bị. Trước khi đổi người dùng, hãy tắt thông báo của trang trong cài đặt trình duyệt.</p> : null;
}
