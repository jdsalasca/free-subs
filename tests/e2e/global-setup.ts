/**
 * Playwright global setup: prepares E2E fixtures.
 *
 * 1. Warms the Whisper "tiny" model into the configured cache.
 * 2. Generates a small test video (speech + color) with ffmpeg when missing.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const audio = path.join(fixtures, 'hello-en.wav');
const video = path.join(fixtures, 'hello-en.mp4');

export default function globalSetup(): void {
  const started = Date.now();
  execSync('npx tsx scripts/warm-model.ts', {
    stdio: 'inherit',
    timeout: 10 * 60 * 1000,
    env: { ...process.env, FREE_SUBS_CACHE_DIR: '.cache/models' },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(`[e2e] whisper tiny ready in ${seconds}s\n`);

  if (!existsSync(video)) {
    if (!existsSync(audio)) {
      process.stdout.write('[e2e] audio fixture missing; run `npm run fixtures` first\n');
      return;
    }
    try {
      execSync(
        `ffmpeg -y -loglevel error -f lavfi -i color=c=0x101828:s=640x360:d=8 -i "${audio}" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 128k -shortest "${video}"`,
        { stdio: 'inherit', timeout: 120_000 },
      );
      process.stdout.write('[e2e] generated hello-en.mp4 fixture\n');
    } catch {
      process.stdout.write('[e2e] could not generate the video fixture; export test will be skipped\n');
    }
  }
}
