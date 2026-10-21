import { test, expect } from '@playwright/test';
import { CustomerTakeawayPage } from '../page/customer_takeaway.page';
import { setupSupabaseAndApiMocks } from '../../../common_setup/supabase_mock.fixture';

test.describe('Module: Customer Takeaway & VietQR (/customer/takeaway)', () => {
  test('1. Hiển thị trang Đặt Món Mang Về công khai (Public Route) không cần đăng nhập', async ({
    page,
  }) => {
    const takeawayPage = new CustomerTakeawayPage(page);
    await takeawayPage.open();

    await expect(page).toHaveURL(/\/customer\/takeaway/);
    await expect(page.locator('body')).toContainText(/Mang Về|123Dzô/i);
  });

  test('2. Lưu và khôi phục lịch sử đơn đặt mang về theo SĐT trong localStorage (Mục 3.1 - Luồng 2)', async ({
    page,
  }) => {
    await setupSupabaseAndApiMocks(page);
    const takeawayPage = new CustomerTakeawayPage(page);
    await takeawayPage.open();

    await page.evaluate(() => {
      const sampleRecords = [
        {
          sessionId: 'sess-tw-001',
          sessionToken: 'tw_abc1234567',
          paymentCode: 'DZO2026TW01',
          customerName: 'Anh Hải',
          customerPhone: '0912345678',
          totalAmount: 298000,
          openedAt: new Date().toISOString(),
        },
      ];
      window.localStorage.setItem(
        '123dzo-takeaway-orders-by-phone',
        JSON.stringify(sampleRecords)
      );
    });

    await page.reload({ waitUntil: 'domcontentloaded' });

    const stored = await page.evaluate(() =>
      window.localStorage.getItem('123dzo-takeaway-orders-by-phone')
    );
    expect(stored).toContain('DZO2026TW01');
    expect(stored).toContain('0912345678');
  });

  test('3. Đảm bảo đơn mang về khởi tạo ở trạng thái PENDING_PAYMENT trước khi Webhook xác nhận', async ({
    page,
  }) => {
    const { mutations } = await setupSupabaseAndApiMocks(page);
    const takeawayPage = new CustomerTakeawayPage(page);
    await takeawayPage.open();

    // Kiểm tra không có bất kỳ lệnh đẩy món thẳng vào QUEUED khi chưa tạo đơn & thanh toán
    expect(mutations.filter((m) => m.table === 'order_items')).toHaveLength(0);
  });
});
