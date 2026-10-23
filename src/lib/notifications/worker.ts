import 'server-only';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { parseNotificationJob, parsePreparedJob } from './contracts';
import { parsePushSubscription } from './subscription';
import { createPushTransport } from './transport';

export async function runNotificationWorker() {
  const send = createPushTransport(); // Fail before DB when configuration is invalid.
  const db = createSupabaseServiceRoleClient();
  const deadline = Date.now() + 20000;
  let accepted = 0, processed = 0, attempts = 0, retrying = 0, failed = 0, skipped = 0;
  for (let index = 0; index < 5 && attempts < 8 && Date.now() < deadline; index++) {
    const claim = await db.rpc('fn_claim_notification_job');
    if (claim.error) throw new Error('WORKER_UNAVAILABLE');
    if (claim.data === null) break;
    const job = parseNotificationJob(claim.data);
    if (!job) throw new Error('WORKER_UNAVAILABLE');
    const lease = { p_id: job.id, p_lease: job.leaseToken };
    let retry = false, code: string | null = null;
    try {
      for (let recipient = 0; recipient < 3 && attempts < 8 && Date.now() < deadline; recipient++) {
        const prepared = await db.rpc('fn_prepare_notification_job', lease);
        const data = !prepared.error && parsePreparedJob(prepared.data);
        if (!data || data.kind !== job.kind || data.tag !== `notification-${job.id}`) throw new Error('PREPARE_FAILED');
        if (!data.target) break;
        attempts++;
        const target = data.target, subscription = parsePushSubscription(target.subscription);
        let expired = !subscription;
        if (subscription) {
          const status = await send(subscription, data.kind, data.tag);
          if (status === 410) expired = true;
          else if (status < 200 || status >= 300) { retry = true; code = status === 429 || status >= 500 ? 'PUSH_TRANSIENT' : 'PUSH_REJECTED'; break; }
        }
        const ack = await db.rpc('fn_ack_notification_recipient', { ...lease, p_staff_id: target.staffId, p_hash: target.subscriptionHash, p_expired: expired });
        if (ack.error) { retry = true; code = 'DELIVERY_UNCERTAIN'; break; }
        if (!expired) accepted++;
      }
    } catch { retry = true; code = 'WORKER_ERROR'; }
    const finish = await db.rpc('fn_finish_notification_job', { ...lease, p_retry: retry, p_error: code });
    if (finish.error || !['SENT','SKIPPED','RETRY','FAILED'].includes(String(finish.data))) throw new Error('WORKER_UNAVAILABLE');
    processed++;
    if (finish.data === 'RETRY') retrying++;
    if (finish.data === 'FAILED') failed++;
    if (finish.data === 'SKIPPED') skipped++;
  }
  return { processed, accepted, retrying, failed, skipped };
}
