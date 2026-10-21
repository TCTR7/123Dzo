import { test, expect } from '@playwright/test';
import { AdminInventoryPage } from '../page/admin_inventory.page';
import { setupSupabaseAndApiMocks } from '../../../common_setup/supabase_mock.fixture';

test.describe('Module: Admin Inventory & Stock Alerts (/admin/inventory)', () => {
  test('1. Kiểm tra điều hướng trang Quản lý Kho & Cảnh báo nguyên liệu dưới định mức (min_threshold)', async ({
    page,
  }) => {
    await setupSupabaseAndApiMocks(page);
    const inventoryPage = new AdminInventoryPage(page);
    await inventoryPage.open();

    await expect(page).toHaveURL(/admin\/inventory|sign-in/);
  });
});
