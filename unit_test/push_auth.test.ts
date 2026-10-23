// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createECDH } from 'node:crypto';

const mocks = vi.hoisted(() => ({ access: vi.fn(), client: vi.fn(), update: vi.fn(), eq: vi.fn(), single: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/sync-staff', () => ({ getCurrentStaffAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: mocks.client }));

import { POST as subscribe } from '@/app/api/push/subscribe/route';
import { POST as notify } from '@/app/api/push/notify/route';

function request(path: string, body: unknown) {
  return new Request(`http://localhost/api/push/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(body),
  });
}
const key = createECDH('prime256v1'); key.generateKeys();
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: key.getPublicKey().toString('base64url'), auth: Buffer.alloc(16,1).toString('base64url') } };

describe('Push route authorization (real guard, mocked identity/data boundaries)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({ status: 'authorized', staff: { userId: 'user_self', role: 'staff', isActive: true } });
    mocks.client.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ select: () => ({ single: mocks.single }) });
    mocks.single.mockResolvedValue({ data: { id: 'user_self', role: 'staff', is_active: true }, error: null });
  });

  it.each([
    { status: 'unauthenticated', expected: 401 },
    { status: 'forbidden', expected: 403 },
    { status: 'unavailable', expected: 503 },
  ])('denies both handlers on $status before business clients are created', async ({ status, expected }) => {
    mocks.access.mockResolvedValue({ status });
    expect((await subscribe(request('subscribe', { staffId: 'user_victim', subscription }))).status).toBe(expected);
    expect((await notify(request('notify', { sessionId: 'session_other' }))).status).toBe(expected);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('does not accept the body staffId as an alternate identity', async () => {
    expect((await subscribe(request('subscribe', { staffId: 'user_victim', subscription }))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('writes the subscription only for the authenticated staff ID', async () => {
    expect((await subscribe(request('subscribe', { subscription }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('fn_set_push_subscription', { p_actor_id: 'user_self', p_subscription: subscription, p_expected_endpoint: null });
  });

  it('denies kitchen access to staff subscriptions', async () => {
    mocks.access.mockResolvedValue({ status: 'authorized', staff: { userId: 'user_kitchen', role: 'kitchen', isActive: true } });
    expect((await subscribe(request('subscribe', { subscription }))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
