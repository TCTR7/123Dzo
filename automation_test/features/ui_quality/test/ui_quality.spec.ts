import { test, expect } from '@playwright/test';
import { UiQualityPage } from '../page/ui_quality.page';

test.describe('Module: UI Quality, PWA Manifest & Responsive Dark Tavern Theme', () => {
  test('1. Trang chủ hiển thị đầy đủ 4 cổng điều hướng (Takeaway, Staff, Kitchen, Admin)', async ({
    page,
  }) => {
    const uiPage = new UiQualityPage(page);
    await uiPage.openLandingPage();

    await expect(uiPage.getTakeawayLink()).toBeVisible();
    await expect(uiPage.getStaffPortalLink()).toBeVisible();
    await expect(uiPage.getKitchenKdsLink()).toBeVisible();
    await expect(uiPage.getAdminDashboardLink()).toBeVisible();
  });

  test('2. Kiểm tra file cấu hình PWA /manifest.json phản hồi hợp lệ (200 OK) và đúng chuẩn 123Dzô', async ({
    request,
  }) => {
    const response = await request.get('/manifest.json');
    expect(response.status()).toBe(200);
    const manifest = (await response.json()) as {
      name: string;
      display: string;
      background_color: string;
    };
    expect(manifest.name).toContain('123Dzô');
    expect(manifest.display).toBe('standalone');
  });

  test('3. Kiểm tra màu nền Dark Tavern (bg-zinc-950) chống chói mắt khi nhân viên/bếp dùng ban đêm', async ({
    page,
  }) => {
    const uiPage = new UiQualityPage(page);
    await uiPage.openLandingPage();

    const bodyClass = await page.locator('body').getAttribute('class');
    expect(bodyClass).toContain('bg-zinc-950');
  });
});
