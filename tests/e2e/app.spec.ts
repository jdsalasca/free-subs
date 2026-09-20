/**
 * End-to-end tests: real browser -> real HTTP API -> real local Whisper model.
 *
 * Fixtures are real speech generated offline with Windows SAPI
 * (`npm run fixtures`): hello-en.wav and hola-es.wav.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_EN = path.join(here, 'fixtures', 'hello-en.wav');
const FIXTURE_ES = path.join(here, 'fixtures', 'hola-es.wav');
const TRANSCRIBE_TIMEOUT_MS = 8 * 60 * 1000;

async function transcribeFixture(page: Page, fixture: string, language: string): Promise<string> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture);
  await page.getByTestId('language-select').selectOption(language);
  await page.getByTestId('model-select').selectOption('tiny');
  await page.getByTestId('transcribe-button').click();
  await expect(page.getByTestId('status-done')).toBeVisible({ timeout: TRANSCRIBE_TIMEOUT_MS });
  return page.getByTestId('transcript').innerText();
}

test.describe('free-subs end to end', () => {
  test.beforeAll(() => {
    expect(existsSync(FIXTURE_EN), 'run `npm run fixtures` first').toBeTruthy();
    expect(existsSync(FIXTURE_ES), 'run `npm run fixtures` first').toBeTruthy();
  });

  test('health endpoint reports ok', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { status: string; name: string };
    expect(body.status).toBe('ok');
    expect(body.name).toBe('free-subs');
  });

  test('transcribes English speech and downloads a valid SRT', async ({ page }) => {
    const transcript = await transcribeFixture(page, FIXTURE_EN, 'en');
    const lower = transcript.toLowerCase();
    expect(lower).toMatch(/hello/);
    expect(lower).toMatch(/world|subtitle|offline|free subs/);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-srt').click();
    const download = await downloadPromise;
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const srt = await readFile(filePath as string, 'utf8');

    // Valid SRT: sequential index, timestamp line, non-empty text.
    expect(srt).toMatch(/^1\r?\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\r?\n/);
    expect(srt.toLowerCase()).toContain('hello');
    expect(srt.trim().length).toBeGreaterThan(10);
  });

  test('transcribes Spanish speech and exports VTT', async ({ page }) => {
    const transcript = await transcribeFixture(page, FIXTURE_ES, 'es');
    expect(transcript.toLowerCase()).toMatch(/hola/);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-vtt').click();
    const download = await downloadPromise;
    const filePath = await download.path();
    const vtt = await readFile(filePath as string, 'utf8');
    expect(vtt.startsWith('WEBVTT')).toBeTruthy();
    expect(vtt).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/);
  });
});
