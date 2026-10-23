import { test, expect } from '@playwright/test';
import { CustomerTakeawayPage } from '../page/customer_takeaway.page';

test.describe('Takeaway remains unavailable until provider rollout', () => {
 test('public page explains availability and offers no payment action', async ({ page }) => {
  const takeaway = new CustomerTakeawayPage(page);
  await takeaway.open();
  await expect(page).toHaveURL(/\/customer\/takeaway/);
  await expect(takeaway.getUnavailableNotice()).toBeVisible();
  await expect(takeaway.getCreateVietQrOrderButton()).toHaveCount(0);
  await expect(takeaway.getCustomerPhoneInput()).toHaveCount(0);
 });
 test('webhook stays closed even when a forged payment is sent', async ({ request }) => {
  const response = await request.post('/api/webhooks/payment', { data: { amount: 298000, payment_code: 'TEST_ONLY_FORGED' } });
  expect(response.status()).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: 'PAYMENT_NOT_CONFIGURED' } });
 });
});
