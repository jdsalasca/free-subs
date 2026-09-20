/**
 * Playwright global setup: makes sure the Whisper "tiny" model is present in
 * the cache before the E2E suite starts, so transcription tests are not
 * coupled to first-time model downloads.
 */
import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  const started = Date.now();
  execSync('npx tsx scripts/warm-model.ts', {
    stdio: 'inherit',
    timeout: 10 * 60 * 1000,
    env: { ...process.env, FREE_SUBS_CACHE_DIR: '.cache/models' },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(`[e2e] whisper tiny ready in ${seconds}s\n`);
}
