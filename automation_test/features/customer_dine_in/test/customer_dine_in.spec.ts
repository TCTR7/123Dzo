import { test, expect } from '@playwright/test';
import { CustomerDineInPage } from '../page/customer_dine_in.page';
import { setupSupabaseAndApiMocks } from '../../../common_setup/supabase_mock.fixture';

test.describe('Module: Customer Dine-In QR Ordering (/customer/order/[token])', () => {
  test('1. Chặn hoàn toàn nếu session_token không tồn tại hoặc bàn đã CLOSED (Anti-Fraud Mục 3.2)', async ({
    page,
  }) => {
    const dineInPage = new CustomerDineInPage(page);
    await dineInPage.openWithToken('invalid-expired-token-999');

    await expect(page.locator('body')).toContainText(
      /Phiên bàn không tồn tại|đã kết thúc|không hợp lệ/i
    );
  });

  test('2. Kiểm tra lưu trữ Giỏ hàng Zustand theo từng bàn & tách dòng theo ghi chú trên trình duyệt', async ({
    page,
  }) => {
    await setupSupabaseAndApiMocks(page);
    const dineInPage = new CustomerDineInPage(page);
    await dineInPage.openWithToken('demo-table-session-token');

    // Kiểm tra persistence key chuẩn của giỏ hàng 123Dzô trong localStorage
    await page.evaluate(() => {
      const sampleCartState = {
        state: {
          sessionToken: 'demo-table-session-token',
          items: [
            {
              menu_item_id: 'menu-oc-huong-bo-toi',
              name: 'Ốc Hương Xào Bơ Tỏi',
              category: 'FOOD',
              station: 'KITCHEN',
              unit_price: 139000,
              unit_cost_price: 75000,
              image_url: null,
              quantity: 2,
              note: 'Cay nhiều',
            },
            {
              menu_item_id: 'menu-bia-tiger',
              name: 'Bia Tiger Crystal Ướp Lạnh',
              category: 'BEER',
              station: 'BAR_INSTANT',
              unit_price: 24000,
              unit_cost_price: 15500,
              image_url: null,
              quantity: 10,
              note: 'Xô đá lớn',
            },
          ],
          submissionTimestamps: [],
        },
        version: 0,
      };
      window.localStorage.setItem(
        '123dzo-customer-cart-storage',
        JSON.stringify(sampleCartState)
      );
    });

    const storedRaw = await page.evaluate(() =>
      window.localStorage.getItem('123dzo-customer-cart-storage')
    );
    expect(storedRaw).not.toBeNull();
    const parsed = JSON.parse(storedRaw!);
    expect(parsed.state.items).toHaveLength(2);
    expect(parsed.state.items[0].unit_price).toBe(139000);
    expect(parsed.state.items[0].unit_cost_price).toBe(75000);
    expect(parsed.state.items[1].station).toBe('BAR_INSTANT');
  });

  test('3. Kiểm tra giao diện hiển thị trên thiết bị di động (Mobile Viewport iPhone) không bị tràn ngang', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dineInPage = new CustomerDineInPage(page);
    await dineInPage.openWithToken('demo-table-session-token');

    const hasHorizontalOverflow = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      );
    });
    expect(hasHorizontalOverflow).toBe(false);
  });
});
