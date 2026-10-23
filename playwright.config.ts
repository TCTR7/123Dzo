import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './automation_test',
  testMatch: ['features/**/test/*.spec.ts', 'harness_tests/*.spec.ts'],
  outputDir: './automation_test/artifacts/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: './automation_test/artifacts/html-report',
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3123',
    headless: false,
    launchOptions: {
      slowMo: 250,
    },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3123',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
