import { test, expect } from '@playwright/test';
import { AdminAuthPage } from '../page/admin_auth.page';

test.describe('Module: Admin Auth & Clerk RBAC Middleware (Mục 7 PRO_SPEC.md)', () => {
  test('1. Bảo vệ các route Quản trị (/admin, /admin/menu, /admin/inventory) khỏi truy cập ẩn danh', async ({
    page,
  }) => {
    const authPage = new AdminAuthPage(page);

    await authPage.openAdminDashboard();
    await expect(page).toHaveURL(/\/sign-in(?:[/?]|$)/);

    await authPage.openAdminMenu();
    await expect(page).toHaveURL(/\/sign-in(?:[/?]|$)/);

    await authPage.openAdminInventory();
    await expect(page).toHaveURL(/\/sign-in(?:[/?]|$)/);
  });

  test('2. Bảo vệ các route Nội bộ Bếp (/kitchen) và Phục vụ (/staff)', async ({
    page,
  }) => {
    const authPage = new AdminAuthPage(page);

    await authPage.openKitchenPortal();
    await expect(page).toHaveURL(/\/sign-in(?:[/?]|$)/);

    await authPage.openStaffPortal();
    await expect(page).toHaveURL(/\/sign-in(?:[/?]|$)/);
  });

  test('3. Cho phép các route Khách hàng (/, /customer/takeaway, /customer/order/[token]) truy cập tự do không cần đăng nhập', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/customer/takeaway');
    await expect(page).toHaveURL(/\/customer\/takeaway/);
  });
});
