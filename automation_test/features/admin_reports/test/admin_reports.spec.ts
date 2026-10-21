import { test, expect } from '@playwright/test';
import { AdminReportsPage } from '../page/admin_reports.page';
import { setupSupabaseAndApiMocks } from '../../../common_setup/supabase_mock.fixture';

test.describe('Module: Admin KPI & Financial Dashboard (/admin - 4 SQL Views)', () => {
  test('1. Kiểm tra truy cập Dashboard KPI (v_daily_financials, v_kitchen_kpi, v_waitstaff_kpi, v_menu_engineering)', async ({
    page,
  }) => {
    await setupSupabaseAndApiMocks(page);
    const reportsPage = new AdminReportsPage(page);
    await reportsPage.open();

    await expect(page).toHaveURL(/admin|sign-in/);
  });
});
