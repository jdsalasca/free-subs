import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 10 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'retain-on-failure',
  },
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://127.0.0.1:8787/api/health',
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      PORT: '8787',
      FREE_SUBS_MODEL: 'tiny',
      FREE_SUBS_CACHE_DIR: '.cache/models',
    },
  },
});
