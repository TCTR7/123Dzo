import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), protect: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: (patterns: string[]) => (req: NextRequest) => patterns.some((pattern) => new RegExp(`^${pattern}$`).test(req.nextUrl.pathname)),
}));
vi.mock('@/lib/auth/roles', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/roles')>(), resolveStaffProfile: mocks.resolve,
}));
import middleware from '@/middleware';
import { OperatorRoleConstraintError } from '@/lib/auth/roles';

const run = (path: string) => (middleware as unknown as (auth: unknown, req: NextRequest) => Promise<Response>)(
  { protect: mocks.protect }, new NextRequest(`https://pub.example${path}`),
);

beforeEach(() => {
  mocks.protect.mockResolvedValue({ userId: 'user_first' });
  mocks.resolve.mockResolvedValue({ id: 'user_first', role: 'operator', is_active: true });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('Authorization middleware', () => {
  it('allows the PWA manifest without a Clerk session', async () => {
    const response = await run('/manifest.json');
    expect(response.status).toBe(200); expect(mocks.protect).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('redirects an outdated role constraint to a readable setup page instead of throwing', async () => {
    mocks.resolve.mockRejectedValue(new OperatorRoleConstraintError());
    const response = await run('/admin');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://pub.example/access-denied?reason=operator-role');
  });
  it('keeps the error page reachable without retrying the failed bootstrap', async () => {
    const response = await run('/access-denied?reason=operator-role');
    expect(response.status).toBe(200); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('returns a recoverable API error when authorization setup fails', async () => {
    mocks.resolve.mockRejectedValue(new OperatorRoleConstraintError());
    const response = await run('/api/accounts/provision');
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('staff_profiles_role_check');
  });
  it('handles other authorization service failures without granting access', async () => {
    mocks.resolve.mockRejectedValue(new Error('offline'));
    const response = await run('/staff');
    expect(response.headers.get('location')).toBe('https://pub.example/access-denied?reason=auth-setup');
  });
  it('continues to deny an admin access to the operator console', async () => {
    mocks.resolve.mockResolvedValue({ id: 'admin', role: 'admin', is_active: true });
    expect((await run('/operator')).headers.get('location')).toBe('https://pub.example/admin');
  });
});
