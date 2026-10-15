import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, runWithPage) => {
    // No public IP request leaves the browser test environment.
    await page.route('https://ipapi.co/json/', (route) => route.fulfill({ status: 429 }));
    await runWithPage(page);
  },
});
export { expect };
