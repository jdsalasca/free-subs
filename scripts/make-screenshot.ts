/**
 * Generates docs/screenshot.png from the real app running a real transcription.
 * Usage: npm run build && npx tsx scripts/make-screenshot.ts
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PORT = 8899;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests', 'e2e', 'fixtures', 'hello-en.wav');
const outFile = path.join(root, 'docs', 'screenshot.png');

async function waitForHealth(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become healthy at ${url}`);
}

const server = spawn(process.execPath, ['dist/server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), FREE_SUBS_CACHE_DIR: '.cache/models' },
  stdio: 'inherit',
});

try {
  const base = `http://127.0.0.1:${PORT}`;
  await waitForHealth(`${base}/api/health`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(base);
  await page.getByTestId('file-input').setInputFiles(fixture);
  await page.getByTestId('language-select').selectOption('en');
  await page.getByTestId('model-select').selectOption('tiny');
  await page.getByTestId('transcribe-button').click();
  await page.getByTestId('status-done').waitFor({ timeout: 8 * 60 * 1000 });

  await mkdir(path.dirname(outFile), { recursive: true });
  await page.screenshot({ path: outFile, fullPage: true });
  await browser.close();
  process.stdout.write(`screenshot saved to ${outFile}\n`);
} finally {
  server.kill();
}
