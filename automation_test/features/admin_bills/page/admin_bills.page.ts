import type { Locator } from '@playwright/test';
import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class AdminBillsPage extends BasePage {
  async open(): Promise<void> {
    await this.goto(TEST_ENV.routes.adminBills);
  }

  getOpenSessionsTab(): Locator {
    return this.page.getByRole('button', { name: /Đang mở \/ Chờ tính tiền/i });
  }

  getClosedSessionsTab(): Locator {
    return this.page.getByRole('button', { name: /Lịch sử đã đóng/i });
  }

  getPrintAndCloseButton(): Locator {
    return this.page.getByRole('button', { name: /In Bill & Đóng bàn/i });
  }
}
