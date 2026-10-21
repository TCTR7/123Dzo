import { BasePage } from '../../../common_setup/base.page';
import { TEST_ENV } from '../../../common_setup/env.config';

export class AdminAuthPage extends BasePage {
  async openAdminDashboard(): Promise<void> {
    await this.goto(TEST_ENV.routes.adminReports);
  }

  async openAdminMenu(): Promise<void> {
    await this.goto(TEST_ENV.routes.adminMenu);
  }

  async openAdminInventory(): Promise<void> {
    await this.goto(TEST_ENV.routes.adminInventory);
  }

  async openKitchenPortal(): Promise<void> {
    await this.goto(TEST_ENV.routes.kitchenKds);
  }

  async openStaffPortal(): Promise<void> {
    await this.goto(TEST_ENV.routes.staffPortal);
  }
}
