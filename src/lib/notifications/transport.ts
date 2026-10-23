import 'server-only';
import { createECDH } from 'node:crypto';
import webpush from 'web-push';
import { pushSettings } from '@/lib/config/server';
import type { WebPushSubscriptionPayload } from '@/types/database.types';

/** Validate configuration before a job is claimed. No global VAPID mutation. */
export function createPushTransport() {
  const vapidDetails = pushSettings();
  const key = createECDH('prime256v1');
  key.setPrivateKey(Buffer.from(vapidDetails.privateKey, 'base64url'));
  if (!key.getPublicKey().equals(Buffer.from(vapidDetails.publicKey, 'base64url'))) throw new Error('VAPID_CONFIGURATION_INVALID');
  return async (subscription: WebPushSubscriptionPayload, kind: string, tag: string): Promise<number> => {
    const payload = JSON.stringify({ title: kind === 'BILL_REQUESTED' ? 'Bàn đang chờ tính tiền' : kind === 'ORDER_READY_FALLBACK' ? 'Có món cần hỗ trợ bưng' : 'Có món chờ phục vụ',
      body: 'Mở ứng dụng để xem công việc của bạn.', url: '/staff', tag });
    const request = webpush.generateRequestDetails(subscription, payload, { TTL: 120, urgency: 'high', vapidDetails });
    const response = await fetch(request.endpoint, { method: request.method, headers: request.headers,
      body: request.body ? Uint8Array.from(request.body).buffer : undefined, redirect: 'error', signal: AbortSignal.timeout(4500) });
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  };
}
