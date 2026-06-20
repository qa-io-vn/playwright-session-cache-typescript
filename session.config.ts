// STEP 1 — define the cache ONCE. The login lambda is the only place login lives.
import { defineSessionCache } from './src/session-cache';

export const session = defineSessionCache({
  key: 'saucedemo',
  login: async (page) => {
    await page.goto('https://www.saucedemo.com/');
    await page.fill('#user-name', process.env.DEMO_USER ?? 'standard_user');
    await page.fill('#password', process.env.DEMO_PASS ?? 'secret_sauce');
    await page.click('#login-button');
    await page.waitForURL('**/inventory.html');
  },
});
