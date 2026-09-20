/**
 * Generates the README demo GIFs from the real app:
 *   docs/demo-subtitles.gif  - upload + transcription
 *   docs/demo-translate.gif  - transcription + translation to Spanish
 *   docs/demo-export.gif     - transcription + subtitle style change + export
 *
 * Each flow runs in its own Playwright browser context so Playwright records
 * one video per flow; every recording is then converted to an optimized GIF
 * with a two-pass ffmpeg palette. Flow C uses the WAV fixture because ffmpeg
 * accepts the burn-in for audio-only media, matching the other two flows.
 *
 * Usage: npm run build && npx tsx scripts/make-gifs.ts
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';

const PORT = 8898;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests', 'e2e', 'fixtures', 'hello-en.wav');
const videosDir = path.join(root, 'tmp', 'videos');
const docsDir = path.join(root, 'docs');
const serverEntry = path.join(root, 'dist', 'server', 'index.js');
const BASE = `http://127.0.0.1:${PORT}`;
const FLOW_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_GIF_BYTES = 6 * 1024 * 1024;

/** Primary conversion: 10 fps, 900 px wide, two-pass palette. */
const PRIMARY_FILTER =
  'fps=10,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse';
/** Progressively smaller/faster re-encodes for GIFs over the size budget. */
const FALLBACK_FILTERS = [
  'fps=10,setpts=PTS/1.5,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
  'fps=10,setpts=PTS/2,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
  'fps=8,setpts=PTS/2.5,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
];

interface Gif {
  name: string;
  filePath: string;
  bytes: number;
}

async function waitForHealth(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become healthy at ${url}`);
}

/** Run a command and reject with the captured stderr tail on failure. */
function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim().slice(-4000);
    throw new Error(`${command} exited with code ${result.status ?? 'unknown'}\n${detail}`);
  }
}

async function existingWebm(): Promise<string[]> {
  try {
    const entries = await readdir(videosDir);
    return entries.filter((entry) => entry.endsWith('.webm'));
  } catch {
    return [];
  }
}

/** Pick the recording created after `before` was captured (newest by mtime). */
async function findNewWebm(before: Set<string>): Promise<string> {
  const after = await existingWebm();
  const fresh = after.filter((name) => !before.has(name));
  if (fresh.length === 0) {
    throw new Error(`No new .webm recording was produced in ${videosDir}`);
  }
  const ranked = await Promise.all(
    fresh.map(async (name) => {
      const info = await stat(path.join(videosDir, name));
      return { name, mtime: info.mtimeMs };
    }),
  );
  ranked.sort((a, b) => a.mtime - b.mtime);
  const newest = ranked[ranked.length - 1];
  if (newest === undefined) {
    throw new Error(`No .webm recording found in ${videosDir}`);
  }
  return path.join(videosDir, newest.name);
}

/** Convert one recording to `gifPath`, shrinking it when it exceeds the budget. */
async function convertToGif(webm: string, gifPath: string): Promise<number> {
  run('ffmpeg', ['-y', '-i', webm, '-vf', PRIMARY_FILTER, '-loop', '0', gifPath]);
  let bytes = (await stat(gifPath)).size;

  for (const filter of FALLBACK_FILTERS) {
    if (bytes <= MAX_GIF_BYTES) {
      break;
    }
    process.stdout.write(`[gif] ${path.basename(gifPath)} is ${(bytes / 1024 / 1024).toFixed(2)} MB, re-encoding\n`);
    run('ffmpeg', ['-y', '-i', webm, '-vf', filter, '-loop', '0', gifPath]);
    bytes = (await stat(gifPath)).size;
  }

  if (bytes > MAX_GIF_BYTES) {
    process.stdout.write(`[gif] warning: ${path.basename(gifPath)} is still ${(bytes / 1024 / 1024).toFixed(2)} MB\n`);
  }
  return bytes;
}

/** Record a single flow in its own context and return the resulting GIF. */
async function recordFlow(
  browser: Browser,
  gifName: string,
  steps: (page: Page) => Promise<void>,
): Promise<Gif> {
  const before = new Set(await existingWebm());
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: videosDir, size: { width: 1280, height: 800 } },
  });

  try {
    const page = await context.newPage();
    await page.goto(BASE);
    await page.getByTestId('dropzone').waitFor({ state: 'visible' });
    await steps(page);
    await page.waitForTimeout(1500);
  } finally {
    await context.close();
  }

  const webm = await findNewWebm(before);
  const gifPath = path.join(docsDir, gifName);
  const bytes = await convertToGif(webm, gifPath);
  process.stdout.write(`[gif] ${path.relative(root, gifPath)} (${(bytes / 1024 / 1024).toFixed(2)} MB)\n`);
  return { name: gifName, filePath: gifPath, bytes };
}

/** Shared transcription steps (upload -> en/tiny -> wait for done). */
async function transcribe(page: Page): Promise<void> {
  await page.getByTestId('file-input').setInputFiles(fixture);
  await page.waitForTimeout(400);
  await page.getByTestId('language-select').selectOption('en');
  await page.getByTestId('model-select').selectOption('tiny');
  await page.waitForTimeout(400);
  await page.getByTestId('transcribe-button').click();
  await page.getByTestId('status-done').waitFor({ state: 'visible', timeout: FLOW_TIMEOUT_MS });
}

async function flowSubtitles(page: Page): Promise<void> {
  await transcribe(page);
  // Reveal the success banner so the GIF ends on the finished state.
  await page.getByTestId('status-done').scrollIntoViewIfNeeded();
}

async function flowTranslate(page: Page): Promise<void> {
  await transcribe(page);
  await page.getByTestId('translate-target').selectOption('es');
  await page.waitForTimeout(400);
  await page.getByTestId('translate-button').click();
  const done = page.getByTestId('translate-done');
  await done.waitFor({ state: 'visible', timeout: FLOW_TIMEOUT_MS });
  await done.scrollIntoViewIfNeeded();
}

async function flowExport(page: Page): Promise<void> {
  await transcribe(page);
  const fontSize = page.getByTestId('export-font-size');
  await fontSize.scrollIntoViewIfNeeded();
  await fontSize.fill('72');
  await page.waitForTimeout(500);
  await page.getByTestId('export-button').click();
  const done = page.getByTestId('export-done');
  await done.waitFor({ state: 'visible', timeout: FLOW_TIMEOUT_MS });
  await done.scrollIntoViewIfNeeded();
}

if (!existsSync(serverEntry)) {
  throw new Error(`Missing ${path.relative(root, serverEntry)}. Run \`npm run build\` first.`);
}

const server = spawn(process.execPath, ['dist/server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), FREE_SUBS_CACHE_DIR: '.cache/models' },
  stdio: 'inherit',
});

let browser: Browser | undefined;
const gifs: Gif[] = [];

try {
  await waitForHealth(`${BASE}/api/health`);
  await rm(videosDir, { recursive: true, force: true });
  await mkdir(videosDir, { recursive: true });
  await mkdir(docsDir, { recursive: true });

  browser = await chromium.launch();
  gifs.push(await recordFlow(browser, 'demo-subtitles.gif', flowSubtitles));
  gifs.push(await recordFlow(browser, 'demo-translate.gif', flowTranslate));
  gifs.push(await recordFlow(browser, 'demo-export.gif', flowExport));

  process.stdout.write('\nGenerated GIFs:\n');
  for (const gif of gifs) {
    process.stdout.write(
      `  ${path.relative(root, gif.filePath)}  ${(gif.bytes / 1024 / 1024).toFixed(2)} MB\n`,
    );
  }
} finally {
  if (browser !== undefined) {
    await browser.close().catch(() => undefined);
  }
  server.kill();
}
