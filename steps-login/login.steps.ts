import { expect } from '@playwright/test';
import { Given, When, Then } from './world';

Given('I am on the login page', async ({ page }) => {
  await page.goto('/');
});

When('I log in with {string} and {string}', async ({ page }, username: string, password: string) => {
  await page.fill('#user-name', username);
  await page.fill('#password', password);
  await page.click('#login-button');
});

Then('I should land on the inventory page', async ({ page }) => {
  await expect(page).toHaveURL(/inventory\.html/);
  await expect(page.locator('.title')).toHaveText('Products');
});

Then('I should see the login error {string}', async ({ page }, message: string) => {
  await expect(page.locator('[data-test="error"]')).toContainText(message);
});
