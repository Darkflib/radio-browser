import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom gives us localStorage, AbortSignal and a DOM for the store/api/render
    // tests. Individual pure modules (cluster) don't need it but it's harmless.
    environment: 'jsdom',
    // Only unit/integration specs. Playwright e2e lives under tests/e2e and is
    // run separately (npm run test:e2e) so browser tests never gate `npm test`.
    include: ['tests/unit/**/*.test.js'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Only the pure/business-logic modules are held to a bar. The globe/UI
      // layers are WebGL- and DOM-heavy and are exercised behaviourally by the
      // Playwright e2e suite instead of by coverage.
      include: ['src/api.js', 'src/store.js', 'src/cluster.js'],
      thresholds: {
        // Per the handoff: api/store/cluster at 85% lines/functions, 75% branches.
        lines: 85,
        functions: 85,
        branches: 75,
        // Overall project floor (only the included files count here).
        statements: 85,
      },
    },
  },
});
