import type { Locator } from '@playwright/test';
import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class StaffPortalPage extends BasePage {
  async open(): Promise<void> {
    await this.goto(TEST_ENV.routes.staffPortal);
  }

  getZoneFilterButton(zoneName: string): Locator {
    return this.page.getByRole('button', { name: zoneName });
  }

  getOpenTableButton(): Locator {
    return this.page.getByRole('button', { name: /Mở bàn/i }).first();
  }

  getOrderForCustomerButton(): Locator {
    return this.page.getByRole('button', { name: /Order hộ khách/i });
  }

  getTransferTableButton(): Locator {
    return this.page.getByRole('button', { name: /Chuyển bàn/i });
  }

  getHandoverTableButton(): Locator {
    return this.page.getByRole('button', { name: /Bàn giao bàn/i });
  }

  getReturnBeerButton(): Locator {
    return this.page.getByRole('button', { name: /Trả lại bia thừa/i });
  }

  getServedButton(): Locator {
    return this.page.getByRole('button', { name: /Đã bưng lên bàn/i }).first();
  }
}
