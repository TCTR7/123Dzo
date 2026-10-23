'use client';
import { activeRegistration, registerPwa } from './registration';
const OWNER = '123dzo-push-owner';
const pendingRemoval = new Map<string, string>();
let currentActor: string | null | undefined;
let actorVersion = 0;
function assertActor(userId: string, version: number) {
  if (version !== actorVersion || currentActor !== undefined && currentActor !== userId) throw new Error('Tài khoản đã thay đổi. Hãy đăng ký lại từ tài khoản hiện tại.');
}
export function supportsDevicePush() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
function applicationKey(): Uint8Array<ArrayBuffer> {
  const text = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!text || !/^[A-Za-z0-9_-]{87}$/.test(text)) throw new Error('Quán chưa cấu hình thông báo trên thiết bị.');
  const decoded = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '=');
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Quán chưa cấu hình thông báo trên thiết bị.');
  return bytes;
}
async function saveSubscription(userId: string, subscription: PushSubscription) {
  const response = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffId: userId, subscription: subscription.toJSON() }), cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Chưa xác nhận đăng ký với quán. Chạm Đăng ký lại để kiểm tra.');
}
async function clearServer(userId: string, endpoint: string): Promise<boolean> {
  pendingRemoval.set(userId, endpoint);
  try {
    const response = await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId: userId, endpoint }), cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) return false;
    pendingRemoval.delete(userId); return true;
  } catch { return false; }
}
/** Called directly inside the click handler: permission request precedes asynchronous work. */
export function enableDevicePush(userId: string): Promise<void> {
  if (!supportsDevicePush()) return Promise.reject(new Error('Thiết bị chưa hỗ trợ. Trên iPhone/iPad hãy mở ứng dụng từ Màn hình chính.'));
  const version = actorVersion;
  let key: Uint8Array<ArrayBuffer>;
  try { assertActor(userId, version); key = applicationKey(); localStorage.getItem(OWNER); }
  catch (error) { return Promise.reject(error instanceof Error ? error : new Error('Không lưu được tùy chọn thiết bị.')); }
  const permission = Notification.permission === 'granted' ? Promise.resolve('granted' as NotificationPermission) : Notification.requestPermission();
  return (async () => {
    if (await permission !== 'granted') throw new Error('Chưa được cấp quyền. Hãy bật thông báo trong cài đặt trình duyệt rồi thử lại.');
    assertActor(userId, version);
    const registration = await activeRegistration();
    let subscription = await registration.pushManager.getSubscription();
    assertActor(userId, version);
    const owner = localStorage.getItem(OWNER);
    if (subscription && owner !== userId) { if (!await subscription.unsubscribe()) throw new Error('Chưa gỡ được đăng ký cũ trên máy. Hãy thử lại.'); subscription = null; }
    if (subscription?.options.applicationServerKey && !equalKey(subscription.options.applicationServerKey, key)) {
      const endpoint = subscription.endpoint;
      if (!await subscription.unsubscribe()) throw new Error('Chưa gỡ được đăng ký cũ trên máy. Hãy thử lại.');
      await clearServer(userId, endpoint); subscription = null;
    }
    assertActor(userId, version);
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    try { assertActor(userId, version); } catch (error) { await subscription.unsubscribe(); throw error; }
    localStorage.setItem(OWNER, userId);
    await saveSubscription(userId, subscription);
    assertActor(userId, version);
    pendingRemoval.delete(userId);
  })();
}
function equalKey(buffer: ArrayBuffer, bytes: Uint8Array) {
  const previous = new Uint8Array(buffer);
  return previous.length === bytes.length && previous.every((byte, i) => byte === bytes[i]);
}
export async function disableDevicePush(userId: string): Promise<boolean> {
  const version = actorVersion;
  assertActor(userId, version);
  const registration = await registerPwa(), subscription = await registration.pushManager.getSubscription();
  assertActor(userId, version);
  let endpoint = pendingRemoval.get(userId);
  if (subscription && localStorage.getItem(OWNER) === userId) {
    endpoint = subscription.endpoint;
    if (!await subscription.unsubscribe()) throw new Error('Chưa tắt được thông báo trên máy. Hãy thử lại.');
  }
  if (localStorage.getItem(OWNER) === userId) localStorage.removeItem(OWNER);
  for (const notification of await registration.getNotifications()) notification.close();
  return endpoint ? clearServer(userId, endpoint) : true;
}
/** No permission prompt or automatic server-side registration on login. */
export function reconcilePushOwner(userId: string | null): Promise<void> {
  currentActor = userId;
  const version = ++actorVersion;
  return reconcile(userId, version);
}
async function reconcile(userId: string | null, version: number) {
  if (!supportsDevicePush()) return;
  const registration = await registerPwa();
  const owner = localStorage.getItem(OWNER), subscription = await registration.pushManager.getSubscription();
  if (version !== actorVersion) return;
  if (!userId || owner !== userId) {
    if (subscription && !await subscription.unsubscribe()) throw new Error('DEVICE_UNSUBSCRIBE_FAILED');
    localStorage.removeItem(OWNER);
    for (const notification of await registration.getNotifications()) notification.close();
  }
}
