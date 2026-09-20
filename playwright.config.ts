import { defineConfig } from '@playwright/test';
import path from 'node:path';

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
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${path.resolve('tests/e2e/fixtures/hello-en.wav')}`,
      ],
    },
  },
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://127.0.0.1:8787/api/health',
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      PORT: '8787',
      FREE_SUBS_CACHE_DIR: '.cache/models',
    },
  },
});
