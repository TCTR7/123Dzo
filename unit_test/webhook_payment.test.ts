import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Supabase Service Role Client để kiểm thử độc lập toàn bộ luồng POST /api/webhooks/payment
const mockSingleSession = vi.fn();
const mockUpdateSession = vi.fn();
const mockUpdateOrderItems = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === 'table_sessions') {
        return {
          select: () => ({
            eq: () => ({
              single: mockSingleSession,
            }),
          }),
          update: (payload: unknown) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: () => mockUpdateSession(payload),
                }),
              }),
              select: () => ({
                single: () => mockUpdateSession(payload),
              }),
            }),
          }),
        };
      }
      if (table === 'order_items') {
        return {
          update: (payload: unknown) => ({
            eq: () => ({
              eq: () => ({
                select: () => mockUpdateOrderItems(payload),
              }),
            }),
          }),
        };
      }
      if (table === 'menu_items') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      return {};
    },
  }),
}));

import { POST } from '@/app/api/webhooks/payment/route';

describe('Unit Test: Webhook Thanh Toán (/api/webhooks/payment)', () => {
  const SEPAY_SECRET = 'test_sepay_webhook_secret_123';
  const PAYOS_KEY = 'test_payos_checksum_key_456';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SEPAY_WEBHOOK_SECRET = SEPAY_SECRET;
    delete process.env.PAYOS_CHECKSUM_KEY;
  });

  afterEach(() => {
    delete process.env.SEPAY_WEBHOOK_SECRET;
    delete process.env.PAYOS_CHECKSUM_KEY;
  });

  it('Từ chối (401) khi chữ ký hoặc Apikey SePay không hợp lệ', async () => {
    const req = new Request('http://localhost:3000/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Apikey wrong_secret',
      },
      body: JSON.stringify({
        content: 'Chuyen khoan DZO2026ABCD',
        transferAmount: 250000,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('Xác thực thành công chữ ký HMAC-SHA256 chuẩn PayOS', async () => {
    process.env.PAYOS_CHECKSUM_KEY = PAYOS_KEY;
    const data = {
      amount: 320000,
      description: 'Thanh toan don mang ve DZO998877',
      orderCode: 998877,
    };
    const queryString = `amount=${data.amount}&description=${data.description}&orderCode=${data.orderCode}`;
    const signature = crypto
      .createHmac('sha256', PAYOS_KEY)
      .update(queryString)
      .digest('hex');

    mockSingleSession.mockResolvedValueOnce({
      data: {
        id: 'sess-takeaway-01',
        session_type: 'TAKEAWAY',
        status: 'PENDING_PAYMENT',
        payment_code: 'DZO998877',
        total_amount: 320000,
      },
      error: null,
    });

    mockUpdateSession.mockResolvedValueOnce({
      data: {
        id: 'sess-takeaway-01',
        status: 'ACTIVE',
      },
      error: null,
    });

    mockUpdateOrderItems
      .mockResolvedValueOnce({
        data: [{ id: 'item-1', menu_item_id: 'm1', quantity: 1 }, { id: 'item-2', menu_item_id: 'm2', quantity: 2 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [],
        error: null,
      });

    const req = new Request('http://localhost:3000/api/webhooks/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data, signature }),
    });

    const res = await POST(req);
    const body = (await res.json()) as {
      success: boolean;
      status: string;
      queuedKitchenCount: number;
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('ACTIVE');
    expect(body.queuedKitchenCount).toBe(2);
  });

  it('Đảm bảo tính Idempotency: Trả về 200 idempotent=true nếu đơn TAKEAWAY đã ACTIVE trước đó', async () => {
    mockSingleSession.mockResolvedValueOnce({
      data: {
        id: 'sess-takeaway-02',
        session_type: 'TAKEAWAY',
        status: 'ACTIVE',
        payment_code: 'DZOIDEMPOTENT',
        total_amount: 150000,
      },
      error: null,
    });

    const req = new Request('http://localhost:3000/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Apikey ${SEPAY_SECRET}`,
      },
      body: JSON.stringify({
        content: 'MBVCB.12345.DZOIDEMPOTENT.CT tu 0123456789',
        transferAmount: 150000,
      }),
    });

    const res = await POST(req);
    const body = (await res.json()) as {
      success: boolean;
      idempotent: boolean;
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.idempotent).toBe(true);
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });

  it('Chặn (400) nếu khách chuyển khoản thiếu tiền so với total_amount', async () => {
    mockSingleSession.mockResolvedValueOnce({
      data: {
        id: 'sess-takeaway-03',
        session_type: 'TAKEAWAY',
        status: 'PENDING_PAYMENT',
        payment_code: 'DZOSHORTPAY',
        total_amount: 500000,
      },
      error: null,
    });

    const req = new Request('http://localhost:3000/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Apikey ${SEPAY_SECRET}`,
      },
      body: JSON.stringify({
        content: 'Thanh toan DZOSHORTPAY',
        transferAmount: 200000, // Thiếu 300k
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });
});
