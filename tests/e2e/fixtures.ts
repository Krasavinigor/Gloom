import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  // Existing scenarios exercise Russian UI. Dedicated i18n tests clear this cookie
  // to verify the English default independently of the browser's language.
  storageState: { cookies: [{ name: 'gloom-locale', value: 'ru', domain: '127.0.0.1',
    path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] },
  page: async ({ page }, runWithPage) => {
    // No public IP request leaves the browser test environment.
    await page.route('https://ipapi.co/json/', (route) => route.fulfill({ status: 429 }));
    await runWithPage(page);
  },
});
export { expect };
