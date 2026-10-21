import type { Locator } from '@playwright/test';
import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class AdminStaffPage extends BasePage {
  async open(): Promise<void> {
    await this.goto(TEST_ENV.routes.adminStaff);
  }

  getAddZoneButton(): Locator {
    return this.page.getByRole('button', { name: /Thêm khu vực/i });
  }

  getAddTableButton(): Locator {
    return this.page.getByRole('button', { name: /Thêm bàn mới/i });
  }

  getAddStaffButton(): Locator {
    return this.page.getByRole('button', { name: /Thêm nhân sự/i });
  }
}
