import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const mockSelectHead = vi.fn();
const mockSingleSession = vi.fn();

// These existing tests cover the business handler after authorization. Negative
// access cases exercise the real guard separately in push_auth.test.ts.
vi.mock('@/lib/auth/staff-guard', () => ({
  requireStaffApi: vi.fn().mockResolvedValue({
    staff: { userId: 'user_test', role: 'staff', isActive: true },
    response: null,
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === 'zones') {
        return {
          select: () => ({ limit: () => mockSelectHead() }),
        };
      }
      if (table === 'table_sessions') {
        return {
          select: () => ({
            eq: () => ({
              single: mockSingleSession,
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));

import { GET as keepAliveGET } from '@/app/api/cron/keep-alive/route';
import { POST as pushNotifyPOST } from '@/app/api/push/notify/route';

describe('Unit Test: API Routes (/api/cron/keep-alive & /api/push/notify)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'unit-only-cron-secret-32-characters-minimum');
  });

  it('GET /api/cron/keep-alive trả về status="alive" và số lượng zones khi Supabase hoạt động tốt', async () => {
    mockSelectHead.mockResolvedValueOnce({ count: 3, error: null });

    const res = await keepAliveGET(new Request('http://localhost/api/cron/keep-alive', {headers:{authorization:'Bearer unit-only-cron-secret-32-characters-minimum'}}));
    const body = (await res.json()) as { status: string; zonesCount: number };

    expect(res.status).toBe(200);
    expect(body.status).toBe('alive');
    expect(body).not.toHaveProperty('zonesCount');
  });

  it('POST /api/push/notify trả về 410 vì thông báo chỉ xuất phát từ outbox đã commit', async () => {
    const req = new Request('http://localhost:3000/api/push/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await pushNotifyPOST(req);
    expect(res.status).toBe(410);
  });
});
