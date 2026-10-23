import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelectHead = vi.fn();
const mockSingleSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === 'zones') {
        return {
          select: () => mockSelectHead(),
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
  });

  it('GET /api/cron/keep-alive trả về status="alive" và số lượng zones khi Supabase hoạt động tốt', async () => {
    mockSelectHead.mockResolvedValueOnce({ count: 3, error: null });

    const res = await keepAliveGET();
    const body = (await res.json()) as { status: string; zonesCount: number };

    expect(res.status).toBe(200);
    expect(body.status).toBe('alive');
    expect(body.zonesCount).toBe(3);
  });

  it('POST /api/push/notify trả về 410 vì đã chuyển sang thông báo nội bộ SSE', async () => {
    const req = new Request('http://localhost:3000/api/push/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await pushNotifyPOST(req);
    expect(res.status).toBe(410);
  });
});
