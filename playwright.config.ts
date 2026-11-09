/**
 * End-to-end tests: the production build of the client, served by the demo backend (`npm run start:demo`),
 * driven in Chromium. The demo fleet is seeded, so the scripted incidents (R-009 and R-041 offline, R-017
 * low, R-024 error) are there on every run.
 *
 *   npm run test:e2e
 */
import { defineConfig, devices } from '@playwright/test';

/** Not 8787, so a running `npm run dev` is never mistaken for the test server. */
const PORT = 8797;

export default defineConfig({
  testDir: 'e2e',
  // One demo server for every test, and the outage test changes its state for everyone: run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npm run start:demo',
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
