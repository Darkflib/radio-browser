import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. Tests live in tests/e2e and drive the real app in Chromium with
 * every radio-browser API request intercepted (see tests/e2e/fixtures.js), so
 * no test touches the network. A dev server is started automatically.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // WebGL-via-SwiftShader globe init is slow to boot, so give each test headroom.
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // WebGL via SwiftShader so the globe initialises in headless CI.
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
