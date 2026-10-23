import type { Locator } from '@playwright/test';
import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class CustomerDineInPage extends BasePage {
  async openWithToken(token: string = TEST_ENV.sampleTableToken): Promise<void> {
    await this.goto(TEST_ENV.routes.customerDineIn(token));
  }

  getMenuTab(): Locator {
    return this.page.getByRole('button', { name: /Thực đơn/i });
  }

  getKitchenProgressTab(): Locator {
    return this.page.getByRole('button', { name: /Món đã gọi/i });
  }

  getBillSplitTab(): Locator {
    return this.page.getByRole('button', { name: /Hóa đơn/i });
  }

  getShareQrButton(): Locator {
    return this.page.getByRole('button', { name: /QR bàn|Cùng gọi món/i });
  }

  getSearchInput(): Locator {
    return this.page.getByRole('searchbox', { name: 'Tìm món' });
  }

  getCategoryButton(label: 'Tất cả' | 'Mồi nhậu' | 'Bia' | 'Đồ uống' | 'Khác'): Locator {
    return this.page.getByRole('button', { name: label, exact: true });
  }

  getAddItemButton(itemName: string): Locator {
    return this.page
      .locator('div', { hasText: itemName })
      .getByRole('button', { name: /Thêm/i })
      .first();
  }

  getOpenCartBarButton(): Locator {
    return this.page.getByRole('button', { name: /Xem giỏ hàng|Giỏ hàng/i });
  }

  getSubmitOrderButton(): Locator {
    return this.page.getByRole('button', { name: /Gửi đơn xuống Bếp|Đặt món ngay/i });
  }

  getRequestBillButton(): Locator {
    return this.page.getByRole('button', { name: /Gọi tính tiền/i });
  }
}
