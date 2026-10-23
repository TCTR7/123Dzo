// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffRole } from '@/types/database.types';

const mocks = vi.hoisted(() => ({ access: vi.fn(), redirect: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/sync-staff', () => ({ getCurrentStaffAccess: mocks.access }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { requireStaffApi, requireStaffPage } from '@/lib/auth/staff-guard';

const matrix: { roles: StaffRole[]; actor: StaffRole; allowed: boolean; home: string }[] = [
  { roles: ['admin'], actor: 'admin', allowed: true, home: '/admin' },
  { roles: ['admin'], actor: 'staff', allowed: false, home: '/staff' },
  { roles: ['admin'], actor: 'kitchen', allowed: false, home: '/kitchen' },
  { roles: ['staff', 'admin'], actor: 'staff', allowed: true, home: '/staff' },
  { roles: ['staff', 'admin'], actor: 'admin', allowed: true, home: '/admin' },
  { roles: ['staff', 'admin'], actor: 'kitchen', allowed: false, home: '/kitchen' },
  { roles: ['kitchen', 'admin'], actor: 'kitchen', allowed: true, home: '/kitchen' },
  { roles: ['kitchen', 'admin'], actor: 'admin', allowed: true, home: '/admin' },
  { roles: ['kitchen', 'admin'], actor: 'staff', allowed: false, home: '/staff' },
];

describe('Page and API staff guards', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`); });
  });

  it.each(matrix)('enforces page role matrix: $actor -> $roles ($allowed)', async ({ roles, actor, allowed, home }) => {
    const staff = { userId: 'user_1', role: actor, isActive: true };
    mocks.access.mockResolvedValue({ status: 'authorized', staff });
    if (allowed) expect(await requireStaffPage(roles)).toEqual(staff);
    else await expect(requireStaffPage(roles)).rejects.toThrow(`redirect:${home}`);
  });

  it.each(matrix)('enforces API role matrix: $actor -> $roles ($allowed)', async ({ roles, actor, allowed }) => {
    mocks.access.mockResolvedValue({ status: 'authorized', staff: { userId: 'user_1', role: actor, isActive: true } });
    const result = await requireStaffApi(roles);
    if (allowed) expect(result.staff?.userId).toBe('user_1');
    else {
      expect(result.staff).toBeNull();
      expect(result.response?.status).toBe(403);
    }
  });

  it.each([
    { status: 'unauthenticated', destination: '/sign-in', code: 401 },
    { status: 'forbidden', destination: '/access-denied', code: 403 },
    { status: 'unavailable', destination: '/access-denied?reason=unavailable', code: 503 },
  ])('handles $status without granting an identity', async ({ status, destination, code }) => {
    mocks.access.mockResolvedValue({ status });
    await expect(requireStaffPage(['admin'])).rejects.toThrow(`redirect:${destination}`);
    const result = await requireStaffApi(['admin']);
    expect(result.staff).toBeNull();
    expect(result.response?.status).toBe(code);
    expect(await result.response?.json()).toMatchObject({ error: { retryable: status === 'unavailable' } });
  });
});
