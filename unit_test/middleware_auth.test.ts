// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ handler: vi.fn(), auth: vi.fn(), protect: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('@clerk/nextjs/server')>();
  return {
    ...original,
    clerkMiddleware: (handler: (...args: unknown[]) => unknown) => {
      mocks.handler.mockImplementation(handler);
      return handler;
    },
  };
});

import '@/middleware';

describe('Middleware login boundary (real Clerk route matcher)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: null });
    mocks.protect.mockResolvedValue({ userId: 'user_1', sessionClaims: { metadata: { role: 'staff' } } });
  });

  async function run(path: string) {
    return mocks.handler(Object.assign(mocks.auth, { protect: mocks.protect }), new NextRequest(`http://localhost${path}`));
  }

  it.each(['/', '/customer/order/test-token', '/customer/takeaway', '/sign-in', '/sign-up', '/access-denied', '/api/webhooks/payment', '/api/cron/keep-alive', '/api/cron/notifications', '/api/customer/orders', '/api/customer/operation', '/api/customer/bill', '/api/customer/snapshot', '/api/customer/realtime-ticket', '/api/customer/takeaway'])('keeps public %s accessible', async (path) => {
    expect((await run(path)).status).toBe(200);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.protect).not.toHaveBeenCalled();
  });

  it.each(['/admin', '/admin/menu', '/admin/inventory', '/admin/staff', '/admin/bills', '/staff', '/kitchen'])('requires login for %s and leaves DB role decisions to server guards', async (path) => {
    expect((await run(path)).status).toBe(200);
    expect(mocks.protect).toHaveBeenCalledOnce();
  });

  it('returns 401 JSON for anonymous internal API requests', async () => {
    const response = await run('/api/push/notify');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('allows signed-in API requests to reach their independent DB guards without metadata', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_1' });
    expect((await run('/api/push/subscribe')).status).toBe(200);
  });

  it('does not accidentally expose unrelated webhook routes', async () => {
    expect((await run('/api/webhooks/unexpected')).status).toBe(401);
  });
});
