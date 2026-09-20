/**
 * End-to-end tests: real browser -> real HTTP API -> real local models
 * (Whisper for transcription, OPUS-MT for translation) -> real ffmpeg export.
 *
 * Fixtures are real speech generated offline with Windows SAPI
 * (`npm run fixtures`): hello-en.wav, hola-es.wav and hello-en.mp4.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_EN = path.join(here, 'fixtures', 'hello-en.wav');
const FIXTURE_ES = path.join(here, 'fixtures', 'hola-es.wav');
const FIXTURE_MP4 = path.join(here, 'fixtures', 'hello-en.mp4');
const TRANSCRIBE_TIMEOUT_MS = 8 * 60 * 1000;
const TRANSLATE_TIMEOUT_MS = 8 * 60 * 1000;
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000;

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

  test('theme toggle switches light and dark', async ({ page }) => {
    await page.goto('/');
    const initial = await page.locator('html').getAttribute('data-theme');
    expect(initial === 'light' || initial === 'dark').toBeTruthy();
    await page.getByTestId('theme-toggle').click();
    const flipped = await page.locator('html').getAttribute('data-theme');
    expect(flipped).not.toBe(initial);
    await page.reload();
    expect(await page.locator('html').getAttribute('data-theme')).toBe(flipped);
  });

  test('translates subtitles to Spanish', async ({ page }) => {
    await transcribeFixture(page, FIXTURE_EN, 'en');
    await page.getByTestId('translate-target').selectOption('es');
    await page.getByTestId('translate-button').click();
    await expect(page.getByTestId('translate-done')).toBeVisible({ timeout: TRANSLATE_TIMEOUT_MS });

    const translated = await page.getByTestId('translated-transcript').innerText();
    expect(translated.toLowerCase()).toMatch(/hola|mundo|mundo|subtítulos|subtitulos|prueba/);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-translated-srt').click();
    const download = await downloadPromise;
    const filePath = await download.path();
    const srt = await readFile(filePath as string, 'utf8');
    expect(srt).toMatch(/^1\r?\n\d{2}:\d{2}:\d{2},\d{3} --> /);
  });

  test('exports a video with burned-in subtitles', async ({ page }) => {
    test.skip(!existsSync(FIXTURE_MP4), 'video fixture not available');
    await transcribeFixture(page, FIXTURE_MP4, 'en');

    await page.getByTestId('export-button').click();
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-video').click();
    const download = await downloadPromise;
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const buffer = await readFile(filePath as string);
    expect(buffer.length).toBeGreaterThan(10_000);
    expect(buffer.subarray(4, 8).toString('ascii')).toBe('ftyp');
  });

  test('edits a cue and the exported SRT reflects the change', async ({ page }) => {
    await transcribeFixture(page, FIXTURE_EN, 'en');
    await page.getByTestId('cue-input').first().fill('Hello edited world.');
    await page.getByTestId('save-cues').click();
    await expect(page.getByTestId('editor-status')).toContainText('Guardado', { timeout: 30_000 });
    await expect(page.getByTestId('transcript')).toContainText('Hello edited world.');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-srt').click();
    const download = await downloadPromise;
    const srt = await readFile((await download.path()) as string, 'utf8');
    expect(srt).toContain('Hello edited world.');
  });

  test('start over resets the flow', async ({ page }) => {
    await transcribeFixture(page, FIXTURE_EN, 'en');
    await page.getByTestId('start-over').click();
    await expect(page.getByTestId('status-done')).toHaveCount(0);
    await expect(page.getByTestId('transcribe-button')).toBeDisabled();
  });

  test('downloads the study JSON with cues and words', async ({ page }) => {
    await transcribeFixture(page, FIXTURE_EN, 'en');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-json').click();
    const download = await downloadPromise;
    const raw = await readFile((await download.path()) as string, 'utf8');
    const doc = JSON.parse(raw) as {
      version: number;
      language: string;
      cues: { lines: string[]; words: unknown[]; ipa?: string }[];
      translations: Record<string, unknown>;
    };
    expect(doc.version).toBe(1);
    expect(doc.language).toBe('en');
    expect(doc.cues.length).toBeGreaterThan(0);
    expect(Array.isArray(doc.cues[0]?.words)).toBe(true);
    expect(typeof doc.cues[0]?.ipa).toBe('string');
    expect(doc.translations).toEqual({});
  });

  test('serves a per-line audio clip', async ({ page, request }) => {
    await transcribeFixture(page, FIXTURE_EN, 'en');
    const href = await page.getByTestId('download-srt').getAttribute('href');
    const jobId = /\/api\/jobs\/([^/]+)\//.exec(href ?? '')?.[1];
    expect(jobId).toBeTruthy();
    const response = await request.get(`/api/jobs/${jobId}/clip?startMs=500&endMs=1500`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('audio/mp4');
    const body = await response.body();
    expect(body.length).toBeGreaterThan(1000);
    expect(body.subarray(4, 8).toString('ascii')).toBe('ftyp');
  });

  test('live mode transcribes from the microphone in real time', async ({ page }) => {
    test.setTimeout(4 * 60 * 1000);
    await page.goto('/');
    await page.getByTestId('live-model').selectOption('tiny');
    await page.getByTestId('live-language').selectOption('en');
    await page.getByTestId('live-translate').selectOption('es');
    await page.getByTestId('live-start').click();
    await expect(page.getByTestId('live-status')).toContainText(/Escuchando|Transcribiendo/, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('live-transcript')).toContainText(/hello/i, { timeout: 150_000 });
    await expect(page.getByTestId('live-translation')).not.toBeEmpty({ timeout: 150_000 });
    await page.getByTestId('live-stop').click();
    await expect(page.getByTestId('live-status')).toContainText('Inactivo', { timeout: 30_000 });
  });
});

test.describe('free-subs on a phone viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('renders the main controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('dropzone')).toBeVisible();
    await expect(page.getByTestId('transcribe-button')).toBeVisible();
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
    await expect(page.getByTestId('file-input')).toHaveCount(1);
  });
});
