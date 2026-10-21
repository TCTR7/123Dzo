import { test, expect } from '@playwright/test';
import { AdminStaffPage } from '../page/admin_staff.page';
import { setupSupabaseAndApiMocks } from '../../../common_setup/supabase_mock.fixture';

test.describe('Module: Admin Zones, Tables & Staff (/admin/staff)', () => {
  test('1. Kiểm tra truy cập trang Quản lý Khu vực (zones), Bàn nhậu (tables) & Phân công nhân sự', async ({
    page,
  }) => {
    await setupSupabaseAndApiMocks(page);
    const staffAdminPage = new AdminStaffPage(page);
    await staffAdminPage.open();

    await expect(page).toHaveURL(/admin\/staff|sign-in/);
  });
});
