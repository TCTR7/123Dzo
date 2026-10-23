import 'server-only';
import { ECDH } from 'node:crypto';
import { isRecord } from '@/lib/orders/contracts';
import type { WebPushSubscriptionPayload } from '@/types/database.types';

export function validPushEndpoint(text: string): boolean {
  if (text.length > 2048) return false;
  try {
    const url = new URL(text), host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && (
      host === 'fcm.googleapis.com' || host === 'web.push.apple.com' || host.endsWith('.push.apple.com') ||
      host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com') || host.endsWith('.notify.windows.com')
    );
  } catch { return false; }
}
export function parsePushSubscription(value: unknown): WebPushSubscriptionPayload | null {
  if (!isRecord(value) || typeof value.endpoint !== 'string' || !validPushEndpoint(value.endpoint) || !isRecord(value.keys) ||
    typeof value.keys.auth !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(value.keys.auth) ||
    typeof value.keys.p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(value.keys.p256dh)) return null;
  try {
    // Canonical base64url and an uncompressed P-256 point; crypto validates the point at send.
    const auth = Buffer.from(value.keys.auth, 'base64url'), key = Buffer.from(value.keys.p256dh, 'base64url');
    if (auth.length !== 16 || auth.toString('base64url') !== value.keys.auth || key.length !== 65 || key[0] !== 4 || key.toString('base64url') !== value.keys.p256dh) return null;
    ECDH.convertKey(key, 'prime256v1');
  } catch { return null; }
  return { endpoint: value.endpoint, keys: { auth: value.keys.auth, p256dh: value.keys.p256dh } };
}
