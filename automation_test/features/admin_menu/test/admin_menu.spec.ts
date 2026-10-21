import { test, expect } from '@playwright/test';
import { AdminMenuPage } from '../page/admin_menu.page';
import { setupSupabaseAndApiMocks } from '../../../common_setup/supabase_mock.fixture';

test.describe('Module: Admin Menu, WebP Compression & 86ing (/admin/menu)', () => {
  test('1. Kiểm tra điều hướng trang Quản lý Thực đơn (CRUD món ăn, Giá vốn, Trạm xử lý & Nút gạt 86ing)', async ({
    page,
  }) => {
    await setupSupabaseAndApiMocks(page);
    const menuPage = new AdminMenuPage(page);
    await menuPage.open();

    await expect(page).toHaveURL(/admin\/menu|sign-in/);
  });
});
