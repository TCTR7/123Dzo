// @vitest-environment node
import { generateKeyPairSync, verify } from 'node:crypto';
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), service: vi.fn(), single: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), from: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/staff-guard', () => ({ requireStaffApi: mocks.guard }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: mocks.service }));
import { issueRealtimeTicket } from '@/lib/realtime/ticket';
import { POST as customerTicket } from '@/app/api/customer/realtime-ticket/route';
import { POST as staffTicket } from '@/app/api/staff/realtime-ticket/route';
const session = '10000000-0000-4000-8000-000000000001';
const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = { ...key.privateKey.export({ format: 'jwk' }), kid: 'test-key-only' };
function request(path: string, headers: Record<string,string> = {}, body?: string) {
  return new Request(`https://restaurant.test/api/${path}/realtime-ticket`, { method: 'POST', headers: { Origin: 'https://restaurant.test', ...headers }, body });
}
describe('Scoped realtime ticket issuance', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED', 'true');
    vi.stubEnv('REALTIME_SIGNING_JWK', JSON.stringify(jwk)); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test-project.supabase.co');
    mocks.guard.mockResolvedValue({ staff: { userId: 'user_staff', role: 'staff', isActive: true }, response: null });
    const chain = { select: mocks.select, eq: mocks.eq, in: mocks.in, maybeSingle: mocks.single };
    mocks.select.mockReturnValue(chain); mocks.eq.mockReturnValue(chain); mocks.in.mockReturnValue(chain);
    mocks.from.mockReturnValue(chain); mocks.service.mockReturnValue({ from: mocks.from });
    mocks.single.mockResolvedValue({ data: { id: session }, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('signs a real ES256 JWT with bounded lifetime and least-privileged claims', () => {
    const ticket = issueRealtimeTicket({ kind: 'session', actor: session });
    const [head, body, signature] = ticket.token.split('.');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'ES256', typ: 'JWT', kid: jwk.kid });
    expect(verify('sha256', Buffer.from(`${head}.${body}`), { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(claims).toMatchObject({ iss: 'https://test-project.supabase.co/auth/v1', role: 'authenticated', aud: 'authenticated', app: '123dzo-live-v1', actor_id: session, scope: 'session', topic: ticket.topic });
    expect(claims.exp - claims.iat).toBe(120); expect(claims.sub).toMatch(/^[0-9a-f-]{36}$/);
    expect(ticket.expiresAt).toBe(claims.exp * 1000);
    expect(Object.keys(claims).sort()).toEqual(['actor_id','app','aud','exp','iat','iss','role','scope','sub','topic']);
  });
  it('validates only a live dine-in capability and never accepts a requested topic', async () => {
    const response = await customerTicket(request('customer', { 'x-session-token': 'secret-capability' }, JSON.stringify({ topic: '123dzo:role:admin', actor: 'user_admin' })));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ topic: `123dzo:session:${session}`, actorId: session });
    expect(mocks.from).toHaveBeenCalledWith('table_sessions'); expect(mocks.select).toHaveBeenCalledWith('id');
    expect(mocks.eq).toHaveBeenCalledWith('session_token', 'secret-capability'); expect(mocks.eq).toHaveBeenCalledWith('session_type', 'DINE_IN');
    expect(mocks.in).toHaveBeenCalledWith('status', ['ACTIVE','REQUEST_BILL']);
  });
  it.each([null, '', 'bad token', 'x'.repeat(257)])('rejects malformed capability before DB', async token => {
    expect((await customerTicket(request('customer', token === null ? {} : { 'x-session-token': token }))).status).toBe(404);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('distinguishes missing session from DB outage, without returning diagnostics', async () => {
    mocks.single.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'secret connection string' } });
    expect((await customerTicket(request('customer', { 'x-session-token': 'closed' }))).status).toBe(404);
    const response = await customerTicket(request('customer', { 'x-session-token': 'active' }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('connection');
  });
  it('derives internal role from current guard and ignores actor/role input', async () => {
    const response = await staffTicket(request('staff', {}, '{"role":"admin","actor":"user_admin"}'));
    expect(await response.json()).toMatchObject({ topic: '123dzo:role:staff', actorId: 'user_staff' });
    expect(mocks.guard).toHaveBeenCalledWith(['staff','kitchen','admin']); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([401,403,503])('does not issue an internal ticket when authorization fails %s', async status => {
    mocks.guard.mockResolvedValue({ staff: null, response: NextResponse.json({ error: 'DENIED' }, { status }) });
    const response = await staffTicket(request('staff')); expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('requires exact same-origin POST for both ticket endpoints', async () => {
    for (const handler of [staffTicket,customerTicket]) {
      expect((await handler(request('customer', { Origin: 'https://attacker.test', 'x-session-token': 'active' }))).status).toBe(403);
    }
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('defaults disabled and never substitutes service/anon keys for a signing key', async () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED', 'false');
    expect((await customerTicket(request('customer', { 'x-session-token': 'active' }))).status).toBe(503);
    expect(mocks.service).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED', 'true'); vi.stubEnv('REALTIME_SIGNING_JWK','');
    expect((await staffTicket(request('staff'))).status).toBe(503);
    vi.stubEnv('REALTIME_SIGNING_JWK', JSON.stringify({ ...jwk, crv: 'P-384' }));
    expect(() => issueRealtimeTicket({ kind: 'staff', actor: 'user_staff' })).toThrow();
  });
});
