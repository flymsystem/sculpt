// tests/sw-reload.spec.js — guards the one config line that stopped the
// whole suite flaking.
//
// index.html registers sw.js, sw.js calls clients.claim() on activate,
// and the page's 'controllerchange' listener answers with a single
// window.location.reload(). That is right for a PWA and wrong for a
// test run: every page load navigated twice, and anything a test was
// doing when the second navigation landed died with it — most visibly
// "Execution context was destroyed, most likely because of a
// navigation" out of page.evaluate. Under parallel workers the
// activation is slower, so the reload lands later, inside the
// assertion window rather than before it. The failure moved between
// landing.spec.js and member-portal-responsive.spec.js from run to run
// because it was never about either page.
//
// playwright.config.js sets `serviceWorkers: 'block'`, which is what
// actually prevents it. The per-test `page.route('**/sw.js', abort)`
// this replaced did NOT: page.route never sees the service-worker
// script request, and the SW installed and reloaded regardless
// (measured: 2 navigations, controller present, 1 registration).
//
// This test asserts the effect, not the setting, so it also catches a
// future Playwright change to what `serviceWorkers: 'block'` means.
import { test, expect } from '@playwright/test';

test('a page load does not navigate twice, and no service worker takes control', async ({ page }) => {
  const navigations = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });

  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();

  // Long enough for a real SW to install, activate and claim — the
  // whole failure mode is this happening LATE, so a short wait here
  // would pass for the wrong reason.
  await page.waitForTimeout(2500);

  expect(
    await page.evaluate(() => !!navigator.serviceWorker?.controller),
    'A service worker took control of the page — its controllerchange reload is exactly what makes this suite flake'
  ).toBe(false);

  expect(
    navigations.length,
    `The page navigated ${navigations.length} times for one goto() — a reload mid-test is what destroys execution contexts`
  ).toBe(1);
});
