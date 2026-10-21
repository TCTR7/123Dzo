import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * BasePage dùng chung cho toàn bộ Page Object Model (POM) trong automation_test/features
 */
export class BasePage {
  protected readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
  }

  async waitForHeading(text: string | RegExp): Promise<Locator> {
    const heading = this.page.getByRole('heading', { name: text }).first();
    await expect(heading).toBeVisible();
    return heading;
  }

  async captureArtifactScreenshot(fileName: string): Promise<void> {
    await this.page.screenshot({
      path: `automation_test/artifacts/${fileName}.png`,
      fullPage: true,
    });
  }
}
