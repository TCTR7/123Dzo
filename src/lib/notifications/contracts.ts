import { isRecord, UUID } from '@/lib/orders/contracts';
export interface NotificationJob { id: string; leaseToken: string; kind: string }
export interface NotificationTarget { staffId: string; subscriptionHash: string; subscription: unknown }
export function parseNotificationJob(value: unknown): NotificationJob | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id) || typeof value.leaseToken !== 'string' || !UUID.test(value.leaseToken) || typeof value.kind !== 'string') return null;
  return { id: value.id, leaseToken: value.leaseToken, kind: value.kind };
}
export function parsePreparedJob(value: unknown): { kind: string; tag: string; target: NotificationTarget | null } | null {
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.tag !== 'string') return null;
  const target = value.target;
  if (target === null) return { kind: value.kind, tag: value.tag, target: null };
  if (!isRecord(target) || typeof target.staffId !== 'string' || typeof target.subscriptionHash !== 'string' || !/^[0-9a-f]{64}$/.test(target.subscriptionHash)) return null;
  return { kind: value.kind, tag: value.tag, target: { staffId: target.staffId, subscriptionHash: target.subscriptionHash, subscription: target.subscription } };
}
export interface NotificationJobStatus { id: string; kind: string; attempts: number; available_at: string; locked_until: string | null; failed_at: string | null; outcome: string | null; last_error: string | null }
export interface NotificationStatus { pending: number; failed: number; jobs: NotificationJobStatus[] }
export function parseNotificationStatus(value: unknown): NotificationStatus | null {
  if (!isRecord(value) || typeof value.pending !== 'number' || !Number.isSafeInteger(value.pending) || value.pending < 0 ||
    typeof value.failed !== 'number' || !Number.isSafeInteger(value.failed) || value.failed < 0 || !Array.isArray(value.jobs) || value.jobs.length > 25) return null;
  const jobs: NotificationJobStatus[] = [];
  for (const row of value.jobs) {
    if (!isRecord(row) || typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.kind !== 'string' || typeof row.attempts !== 'number' || !Number.isSafeInteger(row.attempts) || row.attempts < 0 ||
      typeof row.available_at !== 'string' || !['locked_until','failed_at','outcome','last_error'].every(key => row[key] === null || typeof row[key] === 'string')) return null;
    jobs.push({ id: row.id, kind: row.kind, attempts: row.attempts, available_at: row.available_at,
      locked_until: row.locked_until as string | null, failed_at: row.failed_at as string | null, outcome: row.outcome as string | null, last_error: row.last_error as string | null });
  }
  return { pending: value.pending, failed: value.failed, jobs };
}
