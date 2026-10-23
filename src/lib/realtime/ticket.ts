import 'server-only';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { requiredSetting, supabaseUrl } from '@/lib/config/public';
import { isRecord } from '@/lib/orders/contracts';
import type { StaffRole } from '@/types/database.types';

export type LiveScope = { kind: 'session'; actor: string } | { kind: StaffRole; actor: string };
export function issueRealtimeTicket(scope: LiveScope) {
  if (process.env.NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED !== 'true') throw new Error('REALTIME_DISABLED');
  const value: unknown = JSON.parse(requiredSetting('REALTIME_SIGNING_JWK', process.env.REALTIME_SIGNING_JWK));
  if (!isRecord(value) || value.kty !== 'EC' || value.crv !== 'P-256' ||
      typeof value.kid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.kid) ||
      !['x', 'y', 'd'].every(key => typeof value[key] === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value[key]))) {
    throw new Error('INVALID_REALTIME_KEY');
  }
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: String(value.x), y: String(value.y), d: String(value.d) }, format: 'jwk' });
  const topic = scope.kind === 'session' ? `123dzo:session:${scope.actor}` : `123dzo:role:${scope.kind}`;
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: `${supabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)}/auth/v1`, aud: 'authenticated',
    role: 'authenticated', sub: randomUUID(), iat: now, exp: now + 120,
    app: '123dzo-live-v1', scope: scope.kind, actor_id: scope.actor, topic };
  const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const input = `${encode({ alg: 'ES256', typ: 'JWT', kid: value.kid })}.${encode(claims)}`;
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { token: `${input}.${signature}`, topic, actorId: scope.actor, expiresAt: claims.exp * 1000 };
}
