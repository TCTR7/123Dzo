import type { Locator } from '@playwright/test';
import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class AdminMenuPage extends BasePage {
  async open(): Promise<void> {
    await this.goto(TEST_ENV.routes.adminMenu);
  }

  getAddMenuItemButton(): Locator {
    return this.page.getByRole('button', { name: /Thêm món mới/i });
  }

  getSearchInput(): Locator {
    return this.page.getByPlaceholder(/Tìm kiếm món ăn/i);
  }

  getStationFilterButton(station: 'ALL' | 'KITCHEN' | 'BAR_INSTANT'): Locator {
    return this.page.getByRole('button', { name: new RegExp(station, 'i') });
  }
}
