// tests/checkin-kiosk-exit.spec.js — the desk kiosk's exit button
// (checkin-display.js). Rewritten 2026-08-27: the "hold for 3 seconds"
// gesture this file used to test was replaced with a plain single-tap
// "← Back" button at the client's direction, after the hold silently did
// nothing during a live demo. Root cause (see HANDOVER.md §6
// "window._navTo"): `window._navTo` is assigned once, at
// dashboard/index.js's module top level, which only runs on that
// module's FIRST dynamic import — but app.js's router.go() deletes it on
// EVERY navigation. So the very first time a session left the dashboard
// and came back, the global was gone for good, and the button's
// `window._navTo?.('overview')` call silently did nothing.
//
// The regression this file now guards against is specifically THAT decay
// path — a same-session re-entry into the dashboard — not just "does the
// button work once", since a naive fix (calling `nav` once more) can look
// correct on a fresh page load and still be broken on the second visit.
//
// Needs SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD (owner login) and
// --workers=1, same as the rest of the credentialed suite.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD (owner login)');

async function loginAndReachDashboard(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await page.waitForFunction(() => typeof window._navTo === 'function');
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));
}

async function openKiosk(page) {
  await page.evaluate(() => window._navTo('checkin-display'));
  await page.waitForSelector('#checkin-kiosk', { state: 'visible' });
  await page.waitForSelector('#checkin-exit', { state: 'visible' });
}

test('the exit button is a single tap, not a hold', async ({ page }) => {
  await loginAndReachDashboard(page);
  await openKiosk(page);
  await expect(page.locator('#checkin-exit')).toHaveText(/back/i);
  await page.locator('#checkin-exit').click();
  await expect(page.locator('#checkin-kiosk')).toHaveCount(0, { timeout: 5_000 });
  // Lands on the dashboard overview, not still inside the kiosk overlay.
  await expect(page.locator('#page-gym')).not.toHaveClass(/checkin-kiosk-active/);
});

test('exit still works after leaving the dashboard and coming back — regression for the window._navTo decay bug', async ({ page }) => {
  // Reproduces the exact shape of the client demo: the dashboard is
  // entered, navigated away from (any full route change re-triggers
  // app.js's router.go(), which deletes window._navTo), then re-entered
  // before ever opening the kiosk. Before the fix, dashboard/index.js
  // only ever assigned window._navTo once (at module import time), so by
  // this point the global was already permanently undefined and the old
  // hold-to-exit's window._navTo?.('overview') call was a silent no-op.
  await loginAndReachDashboard(page);

  // Leave the dashboard (member portal is a separate lazy route) and
  // come back — dashboard/index.js's module stays cached by the browser,
  // so its top-level `window._navTo = nav` does NOT run again on re-entry.
  await page.goto('/member/login', { waitUntil: 'load' });
  await page.goto('/dashboard', { waitUntil: 'load' });
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));

  await openKiosk(page);
  await page.locator('#checkin-exit').click();
  await expect(page.locator('#checkin-kiosk')).toHaveCount(0, { timeout: 5_000 });
});

test('the kiosk hides the real sidebar/topbar while open', async ({ page }) => {
  // .checkin-kiosk-active is the second layer (beyond the exit button)
  // stopping the mobile swipe-open sidebar gesture from sliding the real
  // dashboard nav out from underneath the full-screen overlay — untouched
  // by the hold-to-exit removal, and still load-bearing.
  await loginAndReachDashboard(page);
  await openKiosk(page);
  await expect(page.locator('#page-gym')).toHaveClass(/checkin-kiosk-active/);
});
