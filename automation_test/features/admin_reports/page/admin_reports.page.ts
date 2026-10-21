import type { Locator } from '@playwright/test';
import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class AdminReportsPage extends BasePage {
  async open(): Promise<void> {
    await this.goto(TEST_ENV.routes.adminReports);
  }

  getFinancialSectionHeading(): Locator {
    return this.page.getByText(/Tài chính|Doanh thu/i).first();
  }

  getKitchenKpiSectionHeading(): Locator {
    return this.page.getByText(/Kitchen KPI|Hiệu suất Bếp/i).first();
  }

  getWaitstaffKpiSectionHeading(): Locator {
    return this.page.getByText(/Waitstaff KPI|Xếp hạng Nhân viên/i).first();
  }
}
