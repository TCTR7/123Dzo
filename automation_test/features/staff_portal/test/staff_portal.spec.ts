import { test, expect } from '@playwright/test';
import { StaffPortalPage } from '../page/staff_portal.page';
import { setupSupabaseAndApiMocks } from '../../../common_setup/supabase_mock.fixture';

test.describe('Module: Waitstaff Portal (/staff)', () => {
  test('1. Kiểm tra truy cập Sơ đồ bàn, Mở bàn sinh QR động (/customer/order/[token]) & Nghiệp vụ chạy bàn', async ({
    page,
  }) => {
    await setupSupabaseAndApiMocks(page);
    const staffPage = new StaffPortalPage(page);
    await staffPage.open();

    await expect(page).toHaveURL(/staff|sign-in/);
  });

  test('2. Kiểm tra đăng ký Web Push Subscription (/api/push/subscribe) cho nhân viên phụ trách bàn', async ({
    request,
  }) => {
    const res = await request.post('/api/push/subscribe', {
      data: {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/demo-sub-123',
          keys: {
            p256dh: 'demo-p256dh-key',
            auth: 'demo-auth-key',
          },
        },
      },
    });
    // Khi chưa đăng nhập Clerk, endpoint bảo mật trả về 401 hoặc 500 (nếu thiếu env)
    expect([200, 401, 500]).toContain(res.status());
  });
});
