// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ access: vi.fn(), client: vi.fn(), rpc: vi.fn(), clerk: vi.fn(), getUser: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/sync-staff', () => ({ getCurrentStaffAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: mocks.client }));
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: mocks.clerk }));

import { POST } from '@/app/api/admin/staff/route';

const profile = { id: 'user_target', full_name: 'Test staff', role: 'staff', assigned_zone_id: null, is_active: true };
const create = { action: 'create', profile, expected: null };
function request(body: unknown = create, origin: string | null = 'http://localhost') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  return new Request('http://localhost/api/admin/staff', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('Admin staff API: real authorization/validation, mocked Clerk/RPC boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({ status: 'authorized', staff: { userId: 'user_admin', role: 'admin', isActive: true } });
    mocks.client.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: [profile], error: null });
    mocks.clerk.mockResolvedValue({ users: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ id: profile.id, banned: false, locked: false });
  });

  it.each([
    { access: { status: 'unauthenticated' }, status: 401 },
    { access: { status: 'forbidden' }, status: 403 },
    { access: { status: 'unavailable' }, status: 503 },
    { access: { status: 'authorized', staff: { userId: 'user_staff', role: 'staff', isActive: true } }, status: 403 },
    { access: { status: 'authorized', staff: { userId: 'user_kitchen', role: 'kitchen', isActive: true } }, status: 403 },
  ])('denies unauthorized caller before verifying targets or writing: $status', async ({ access, status }) => {
    mocks.access.mockResolvedValue(access);
    expect((await POST(request())).status).toBe(status);
    expect(mocks.clerk).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([null, 'https://attacker.test', 'http://localhost.attacker.test'])('rejects missing/cross-site Origin: %s', async (origin) => {
    expect((await POST(request(create, origin)))).toHaveProperty('status', 403);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.clerk).not.toHaveBeenCalled();
  });

  it('creates only a Clerk-verified target and uses the server actor', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.getUser).toHaveBeenCalledWith('user_target');
    expect(mocks.rpc).toHaveBeenCalledWith('fn_admin_save_staff', {
      p_actor_id: 'user_admin', p_profile: profile, p_expected: null,
    });
    expect(await response.json()).toEqual({ data: profile });
  });

  it('updates with an expected snapshot and does not provision through Clerk', async () => {
    const next = { ...profile, is_active: false };
    mocks.rpc.mockResolvedValue({ data: [next], error: null });
    expect((await POST(request({ action: 'update', profile: next, expected: profile }))).status).toBe(200);
    expect(mocks.clerk).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('fn_admin_save_staff', {
      p_actor_id: 'user_admin', p_profile: next, p_expected: profile,
    });
  });

  it.each([
    null, [], { ...create, actor: 'user_other' },
    { ...create, profile: { ...profile, push_subscription: {} } },
    { ...create, profile: { ...profile, role: 'owner' } },
    { ...create, profile: { ...profile, is_active: 'true' } },
    { action: 'update', profile, expected: null },
    { action: 'update', profile, expected: { ...profile, id: 'user_other' } },
  ])('rejects invalid and privileged fields: %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([
    { user: { id: profile.id, banned: true, locked: false }, status: 422 },
    { user: { id: profile.id, banned: false, locked: true }, status: 422 },
    { user: { id: 'user_wrong' }, status: 422 },
  ])('does not grant access to an unavailable Clerk user: %j', async ({ user, status }) => {
    mocks.getUser.mockResolvedValue(user);
    expect((await POST(request())).status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([{ error: { status: 404 }, status: 404 }, { error: new Error('private Clerk detail'), status: 503 }])('fails closed on Clerk failure: $status', async ({ error, status }) => {
    mocks.getUser.mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('private Clerk detail');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['42501', 403, 'FORBIDDEN'], ['P0002', 404, 'STAFF_NOT_FOUND'],
    ['23505', 409, 'STAFF_EXISTS'], ['P0001', 409, 'LAST_ADMIN'],
    ['40001', 409, 'STAFF_CHANGED'], ['23503', 400, 'INVALID_STAFF_PROFILE'],
    ['22023', 400, 'INVALID_STAFF_PROFILE'], ['XX000', 503, 'STAFF_SAVE_UNAVAILABLE'],
  ])('maps DB %s to %i without raw SQL details', async (code, status, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'private SQL detail' } });
    const response = await POST(request());
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error.code).toBe(expectedCode);
    expect(JSON.stringify(body)).not.toContain('private SQL detail');
  });

  it('rejects malformed JSON as 400, not a successful mutation', async () => {
    const response = await POST(new Request('http://localhost/api/admin/staff', {
      method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: '{',
    }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('bounds the real body even without Content-Length', async () => {
    const response = await POST(request({ ...create, padding: 'x'.repeat(8192) }));
    expect(response.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not report success when RPC returns no row', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await POST(request())).status).toBe(503);
  });
});
