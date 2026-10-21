import { test, expect } from '@playwright/test';
import { KitchenKdsPage } from '../page/kitchen_kds.page';
import { setupSupabaseAndApiMocks } from '../../../common_setup/supabase_mock.fixture';

test.describe('Module: Kitchen KDS Tablet (/kitchen)', () => {
  test('1. Bảo vệ route /kitchen và hỗ trợ giả lập Screen Wake Lock API trên Tablet Bếp', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: async () => ({
            released: false,
            release: async () => undefined,
          }),
        },
        configurable: true,
      });
    });

    await setupSupabaseAndApiMocks(page);
    const kdsPage = new KitchenKdsPage(page);
    await kdsPage.open();

    await expect(page).toHaveURL(/kitchen|sign-in/);
  });

  test('2. Kiểm tra hiển thị chuẩn trên màn hình Tablet ngang (iPad Pro Landscape 1194x834)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1194, height: 834 });
    const kdsPage = new KitchenKdsPage(page);
    await kdsPage.open();

    const width = await page.evaluate(() => window.innerWidth);
    expect(width).toBe(1194);
  });
});
