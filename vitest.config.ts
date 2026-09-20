import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json-summary'],
    include: ['src/core/**/*.ts', 'src/pipeline/**/*.ts', 'src/server/**/*.ts'],
    // The Whisper engine wrapper is only exercised end-to-end (real model),
    // so it is excluded from the unit coverage report on purpose.
    exclude: ['src/pipeline/engine-transformers.ts'],
  },
});
