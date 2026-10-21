import type { Locator } from '@playwright/test';
import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class UiQualityPage extends BasePage {
  async openLandingPage(): Promise<void> {
    await this.goto(TEST_ENV.routes.home);
  }

  getTakeawayLink(): Locator {
    return this.page.getByRole('link', { name: /Đặt Món Mang Về/i });
  }

  getStaffPortalLink(): Locator {
    return this.page.getByRole('link', { name: /Phục Vụ Bàn/i });
  }

  getKitchenKdsLink(): Locator {
    return this.page.getByRole('link', { name: /Màn Hình Bếp/i });
  }

  getAdminDashboardLink(): Locator {
    return this.page.getByRole('link', { name: /Quản Trị & KPI/i });
  }
}
