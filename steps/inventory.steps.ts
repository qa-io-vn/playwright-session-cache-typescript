import { expect } from '@playwright/test';
import { Given, Then } from './world';

// No login step anywhere — the cached session is what makes these pass.
Given('I open the inventory page', async ({ page }) => {
  await page.goto('/inventory.html');
});

Then('I should see the products page', async ({ page }) => {
  await expect(page.locator('.title')).toHaveText('Products');
});

Then('I should see {int} products', async ({ page }, count: number) => {
  await expect(page.locator('.inventory_item')).toHaveCount(count);
});
