import type { Locator } from '@playwright/test';
import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class AdminInventoryPage extends BasePage {
  async open(): Promise<void> {
    await this.goto(TEST_ENV.routes.adminInventory);
  }

  getAddIngredientButton(): Locator {
    return this.page.getByRole('button', { name: /Thêm nguyên liệu/i });
  }

  getCreateInventoryLogButton(): Locator {
    return this.page.getByRole('button', { name: /Nhập \/ Xuất kho/i });
  }

  getLowStockFilterButton(): Locator {
    return this.page.getByRole('button', { name: /Sắp hết hàng/i });
  }
}
