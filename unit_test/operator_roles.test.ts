import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ maybeSingle: vi.fn(), count: vi.fn(), upsert: vi.fn(), saved: vi.fn(), user: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), clerkClient: async () => ({ users: { getUser: mocks.user } }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: () => ({
  from: () => ({ select: (_columns: string, options?: object) => options ? mocks.count() : { eq: () => ({ maybeSingle: mocks.maybeSingle }) },
    upsert: mocks.upsert }),
}) }));
import { canManageRole, getHomeByRole, isConfiguredOperator, resolveStaffProfile, OperatorRoleConstraintError } from '@/lib/auth/roles';

beforeEach(() => {
  vi.stubEnv('OPERATOR_EMAILS', ''); vi.stubEnv('OPERATOR_CLERK_USER_IDS', '');
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.count.mockResolvedValue({ count: 0, error: null });
  mocks.user.mockResolvedValue({ id: 'user_first', firstName: 'First', emailAddresses: [] });
  mocks.upsert.mockReturnValue({ select: () => ({ single: mocks.saved }) });
  mocks.saved.mockResolvedValue({ data: { id: 'user_first', role: 'operator', is_active: true }, error: null });
});

describe('Operator bootstrap and hierarchy', () => {
  it('creates the first profile as operator when the database is empty', async () => {
    expect((await resolveStaffProfile('user_first'))?.role).toBe('operator');
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'user_first', role: 'operator' }), { onConflict: 'id' });
  });
  it('does not grant access to an unknown login once a profile exists', async () => {
    mocks.count.mockResolvedValue({ count: 1, error: null });
    expect(await resolveStaffProfile('user_second')).toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('identifies an outdated live database role constraint during bootstrap', async () => {
    mocks.saved.mockResolvedValue({ data: null, error: { code: '23514', message: 'new row violates check constraint "staff_profiles_role_check"' } });
    await expect(resolveStaffProfile('user_first')).rejects.toBeInstanceOf(OperatorRoleConstraintError);
  });
  it('fails closed on a count error instead of treating the database as empty', async () => {
    mocks.count.mockResolvedValue({ count: null, error: { message: 'offline' } });
    await expect(resolveStaffProfile('user_first')).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('promotes a configured verified email even when profiles already exist', async () => {
    vi.stubEnv('OPERATOR_EMAILS', ' deploy@example.com ');
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'staff', is_active: true }, error: null });
    mocks.user.mockResolvedValue({ id: 'user_first', emailAddresses: [{ emailAddress: 'DEPLOY@example.com', verification: { status: 'verified' } }] });
    expect((await resolveStaffProfile('user_first'))?.role).toBe('operator');
  });
  it('accepts configured Clerk IDs but never unverified operator emails', () => {
    vi.stubEnv('OPERATOR_EMAILS', 'deploy@example.com');
    expect(isConfiguredOperator({ id: 'unknown', emailAddresses: [{ emailAddress: 'deploy@example.com', verification: { status: 'unverified' } }] })).toBe(false);
    vi.stubEnv('OPERATOR_CLERK_USER_IDS', 'user_operator');
    expect(isConfiguredOperator({ id: 'user_operator', emailAddresses: [] })).toBe(true);
  });
  it('keeps inactive accounts blocked', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'operator', is_active: false }, error: null });
    expect(await resolveStaffProfile('user_first')).toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('limits admins to staff/kitchen and routes all four roles correctly', () => {
    expect(canManageRole('admin', 'operator')).toBe(false);
    expect(canManageRole('admin', 'admin')).toBe(false);
    expect(canManageRole('admin', 'staff')).toBe(true);
    expect(canManageRole('admin', 'kitchen')).toBe(true);
    expect(canManageRole('staff', 'staff')).toBe(false);
    expect(canManageRole('operator', 'admin')).toBe(true);
    expect(['operator', 'admin', 'staff', 'kitchen'].map((role) => getHomeByRole(role as 'operator' | 'admin' | 'staff' | 'kitchen'))).toEqual(['/operator', '/admin', '/staff', '/kitchen']);
  });
});
