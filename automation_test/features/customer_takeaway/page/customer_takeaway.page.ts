import type { Locator } from '@playwright/test';
import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class CustomerTakeawayPage extends BasePage {
  async open(): Promise<void> {
    await this.goto(TEST_ENV.routes.customerTakeaway);
  }
  getUnavailableNotice(): Locator {
    return this.page.getByText('Quán chưa mở đặt món và thanh toán trực tuyến.', { exact: false });
  }

  getOrderTabButton(): Locator {
    return this.page.getByRole('button', { name: /Đặt món mới/i });
  }

  getLookupTabButton(): Locator {
    return this.page.getByRole('button', { name: /Tra cứu đơn hàng/i });
  }

  getSearchMenuInput(): Locator {
    return this.page.getByPlaceholder(/Tìm món nhậu mang về/i);
  }

  getCustomerNameInput(): Locator {
    return this.page.getByPlaceholder(/Ví dụ: Anh Tư/i);
  }

  getCustomerPhoneInput(): Locator {
    return this.page.getByPlaceholder(/Ví dụ: 0901234567/i);
  }

  getPhoneLookupInput(): Locator {
    return this.page.getByPlaceholder(/Nhập SĐT đã đặt hàng/i);
  }

  getCreateVietQrOrderButton(): Locator {
    return this.page.getByRole('button', {
      name: /Tạo đơn & Lấy mã thanh toán VietQR/i,
    });
  }
}
