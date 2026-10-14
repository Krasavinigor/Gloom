import { defineConfig, devices } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

if (!/^wardrobe_e2e_[a-f0-9]{32}$/.test(process.env.E2E_MANAGED_SCHEMA ?? '')
  || process.env.DATABASE_SCHEMA !== process.env.E2E_MANAGED_SCHEMA) {
  throw new Error('Use pnpm test:e2e to create isolated database and photo storage.');
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'pnpm exec next start --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/demo',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ENABLE_AI: 'false', OPENAI_API_KEY: '',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(resolve('tests/fixtures/provider-preload.mjs')).href}`.trim(),
    },
  },
});
