import type { Locator } from '@playwright/test';
import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class KitchenKdsPage extends BasePage {
  async open(): Promise<void> {
    await this.goto(TEST_ENV.routes.kitchenKds);
  }

  getOutOfStockDrawerButton(): Locator {
    return this.page.getByRole('button', { name: /Báo hết món/i });
  }

  getBatchCookButton(): Locator {
    return this.page.getByRole('button', { name: /Nấu gộp mẻ/i }).first();
  }

  getSingleCookButton(): Locator {
    return this.page.getByRole('button', { name: /Nhận nấu/i }).first();
  }

  getCompleteDishButton(): Locator {
    return this.page.getByRole('button', { name: /Hoàn thành/i }).first();
  }

  getWakeLockBadge(): Locator {
    return this.page.getByText(/Giữ sáng màn hình|Wake Lock/i);
  }
}
