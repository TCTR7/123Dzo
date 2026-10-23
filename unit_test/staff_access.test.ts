// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), from: vi.fn(), eq: vi.fn(), profile: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: mocks.client }));

import { getCurrentStaffAccess } from '@/lib/supabase/sync-staff';

describe('Staff access uses active DB profiles and never provisions from login', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ userId: 'user_staff', sessionClaims: { metadata: { role: 'admin' } } });
    mocks.client.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ select: () => ({ eq: mocks.eq }) });
    mocks.eq.mockReturnValue({ maybeSingle: mocks.profile });
    mocks.profile.mockResolvedValue({ data: { id: 'user_staff', role: 'staff', is_active: true }, error: null });
  });

  it('does not create a service client for an anonymous caller', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect(await getCurrentStaffAccess()).toEqual({ status: 'unauthenticated' });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(['admin', 'staff', 'kitchen'])('accepts an active %s DB profile even without metadata', async (role) => {
    mocks.auth.mockResolvedValue({ userId: 'user_staff' });
    mocks.profile.mockResolvedValue({ data: { id: 'user_staff', role, is_active: true }, error: null });
    expect(await getCurrentStaffAccess()).toEqual({
      status: 'authorized', staff: { userId: 'user_staff', role, isActive: true },
    });
    expect(mocks.from).toHaveBeenCalledWith('staff_profiles');
    expect(mocks.eq).toHaveBeenCalledWith('id', 'user_staff');
  });

  it('ignores stale admin metadata when DB role is staff', async () => {
    expect(await getCurrentStaffAccess()).toEqual({
      status: 'authorized', staff: { userId: 'user_staff', role: 'staff', isActive: true },
    });
  });

  it.each([
    null,
    { id: 'user_staff', is_active: true },
    { id: 'user_staff', role: 'superadmin', is_active: true },
    { id: 'user_staff', role: 'admin', is_active: false },
    { id: 'user_staff', role: 'admin', is_active: 'true' },
    { id: 'user_other', role: 'admin', is_active: true },
  ])('denies absent, malformed, inactive or mismatched profiles: %j', async (data) => {
    mocks.profile.mockResolvedValue({ data, error: null });
    expect(await getCurrentStaffAccess()).toEqual({ status: 'forbidden' });
  });

  it('does not trust profile data returned alongside a DB error', async () => {
    mocks.profile.mockResolvedValue({ data: { id: 'user_staff', role: 'admin', is_active: true }, error: { message: 'private detail' } });
    expect(await getCurrentStaffAccess()).toEqual({ status: 'unavailable' });
  });

  it.each(['auth', 'config', 'query'])('fails closed on %s failure', async (stage) => {
    if (stage === 'auth') mocks.auth.mockRejectedValue(new Error('private Clerk detail'));
    if (stage === 'config') mocks.client.mockImplementation(() => { throw new Error('private config detail'); });
    if (stage === 'query') mocks.profile.mockRejectedValue(new Error('private DB detail'));
    expect(await getCurrentStaffAccess()).toEqual({ status: 'unavailable' });
  });

  it('reads active state again on the next request', async () => {
    expect((await getCurrentStaffAccess()).status).toBe('authorized');
    mocks.profile.mockResolvedValue({ data: { id: 'user_staff', role: 'staff', is_active: false }, error: null });
    expect(await getCurrentStaffAccess()).toEqual({ status: 'forbidden' });
    expect(mocks.profile).toHaveBeenCalledTimes(2);
  });
});
