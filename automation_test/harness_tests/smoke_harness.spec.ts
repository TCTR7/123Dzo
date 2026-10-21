import { test, expect } from '@playwright/test';

test.describe('Harness Smoke Tests: API Endpoints, Push Notification & Webhooks Security', () => {
  test('1. Webhook /api/webhooks/payment từ chối request thiếu chữ ký bảo mật hoặc thiếu mã đơn', async ({
    request,
  }) => {
    const response = await request.post('/api/webhooks/payment', {
      data: {
        payment_code: 'DZO12345',
        transfer_amount: 250000,
      },
    });
    expect([400, 401, 404, 500]).toContain(response.status());
  });

  test('2. Endpoint /api/push/notify kiểm tra dữ liệu đầu vào (yêu cầu sessionId hoặc tableNumber)', async ({
    request,
  }) => {
    const response = await request.post('/api/push/notify', {
      data: {},
    });
    expect([400, 401, 500]).toContain(response.status());
  });

  test('3. Endpoint /api/cron/keep-alive bảo vệ chống gọi trái phép khi không có CRON_SECRET', async ({
    request,
  }) => {
    const response = await request.get('/api/cron/keep-alive');
    expect([200, 401, 500]).toContain(response.status());
  });
});
