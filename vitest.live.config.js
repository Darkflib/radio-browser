import { defineConfig } from 'vitest/config';

/**
 * Live "canary" config — hits the real radio-browser network.
 *
 * This is deliberately SEPARATE from vitest.config.js so it can never run as
 * part of `npm test` / coverage and never gate a merge. Run it on a schedule or
 * on demand with `npm run test:live`. It asserts only that the service is
 * reachable and the app's contract still roughly holds — never that a specific
 * station exists or plays.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.test.js'],
    // Network is slow and best-effort; give it room and don't retry-fail hard.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // No coverage, no thresholds — this suite is advisory only.
    coverage: { enabled: false },
  },
});
