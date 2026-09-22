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

    // ── Why every test runs without a service worker ────────────────
    // index.html registers sw.js; sw.js calls clients.claim() on
    // activate; the page's 'controllerchange' listener then does ONE
    // window.location.reload(). That is correct PWA behaviour and it
    // fires on the very first activation in a fresh browser context —
    // so EVERY test page load was silently navigating twice.
    //
    // Whatever a test was doing when that reload landed died with it:
    // "Execution context was destroyed, most likely because of a
    // navigation" from page.evaluate, or DOM the test had just built
    // being thrown away. Under parallel workers the activation is
    // slower, so the reload lands later — inside the assertion window
    // instead of before it. That is the whole flake: it moved between
    // landing.spec.js and member-portal-responsive.spec.js run to run
    // because it was never about either page.
    //
    // Individual tests used to try `page.route('**/sw.js', abort)`.
    // Measured: it does nothing — page.route does not intercept the
    // service-worker script request, so the SW installed and the
    // reload happened anyway (2 navigations, controller present).
    // Blocking at the context level is what actually works: 1
    // navigation, no controller, no registration.
    //
    // Nothing under test depends on the SW — it's an offline/update
    // mechanism, not app behaviour. tests/sw-reload.spec.js guards
    // this setting so it can't be quietly dropped.
    serviceWorkers: 'block',
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
