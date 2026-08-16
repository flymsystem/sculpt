// playwright.config.js  —  project root
//
// Runs the tests against the BUILT output (npm run preview), not the dev server.
// That is deliberate: the whole class of bug this catches — the vite base-path /
// Cloudflare catch-all interaction — only exists in the built output. The dev
// server resolves modules differently and would never show it.
//
// Run `npm run build` BEFORE `npx playwright test`, so preview has fresh files
// to serve. (Kept as two separate commands on purpose — chaining them with &&
// inside this config is unreliable on Windows shells.)

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,

  // Fail the run if someone leaves a .only in a committed test.
  forbidOnly: !!process.env.CI,

  // These tests are deterministic — a retry that "fixes" a failure would be
  // hiding a real flake, so don't retry locally.
  retries: 0,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:4173',   // vite preview's default port
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },

    // Uncomment to also check the mobile layout your gym owners actually use.
    // Requires: npx playwright install webkit
    // { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],

  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,   // if you already have preview running, use it
    timeout: 60_000,
  },
});
