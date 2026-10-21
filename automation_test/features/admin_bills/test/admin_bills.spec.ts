import { test, expect } from '@playwright/test';
import { AdminBillsPage } from '../page/admin_bills.page';

test.describe('Module: Admin Bills & K80 Thermal Receipt (/admin/bills)', () => {
  test('1. Kiểm tra điều hướng trang Quản lý Hóa đơn & Đóng bàn', async ({
    page,
  }) => {
    const billsPage = new AdminBillsPage(page);
    await billsPage.open();
    await expect(page).toHaveURL(/admin\/bills|sign-in/);
  });

  test('2. Kiểm tra quy tắc CSS @media print khổ giấy in nhiệt K80 (80mm) đã được nạp trong globals.css', async ({
    page,
  }) => {
    await page.goto('/');
    await page.emulateMedia({ media: 'print' });

    const hasPrintStylesheet = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule.cssText.includes('k80-thermal-receipt')) {
              return true;
            }
          }
        } catch {
          // Bỏ qua stylesheet cross-origin nếu có
        }
      }
      return false;
    });

    expect(hasPrintStylesheet).toBe(true);
  });
});
