// tests/checkin-kiosk-exit.spec.js — hold-to-exit gate on the desk kiosk
// display (checkin-display.js). This tablet sits unattended in a public
// area signed into an account that can see member Aadhaar photos and
// collect payments (see HANDOVER.md §6 and the header comment in
// checkin-display.js) — a tap that could exit the kiosk is a real
// security bug, not a UX nit. These tests exercise the actual button in
// the real dashboard, dispatching genuine PointerEvents at it (rather
// than driving OS-level input) so the pointerId-ownership and capture
// logic in the module under test run exactly as written, with precise
// control over timing and interruption.
//
// Needs SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD (owner login) and
// --workers=1, same as the rest of the credentialed suite.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD (owner login)');

async function openKiosk(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  // Same race as tests/add-member.spec.js: window._navTo exists before
  // the dashboard's own initial nav has necessarily finished, and that
  // initial nav can stomp a nav triggered too early. Wait for the first
  // real render, then navigate, so ours is the last word.
  await page.waitForFunction(() => typeof window._navTo === 'function');
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));
  await page.evaluate(() => window._navTo('checkin-display'));
  await page.waitForSelector('#checkin-kiosk', { state: 'visible' });
  await page.waitForSelector('#checkin-exit', { state: 'visible' });
}

// Dispatches a real PointerEvent at #checkin-exit rather than relying on
// Playwright's OS-level mouse/touch emulation — this gives the test exact
// control over pointerId and timing, which is what's needed to prove the
// interruption paths (cancel, a second stray pointer) actually cancel.
async function dispatchExitPointerEvent(page, type, pointerId = 1, extra = {}) {
  await page.evaluate(({ type, pointerId, extra }) => {
    const btn = document.getElementById('checkin-exit');
    const ev = new PointerEvent(type, {
      pointerId,
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
      ...extra,
    });
    btn.dispatchEvent(ev);
  }, { type, pointerId, extra });
}

test('a genuine 3-second hold triggers the exit', async ({ page }) => {
  await openKiosk(page);
  await dispatchExitPointerEvent(page, 'pointerdown');
  // EXIT_HOLD_MS is 3000; give the rAF loop a safety margin past that.
  await page.waitForTimeout(3400);
  await dispatchExitPointerEvent(page, 'pointerup');
  // A completed hold calls stopCheckinDisplay() + _navTo('overview'),
  // which tears down and replaces #checkin-kiosk entirely.
  await expect(page.locator('#checkin-kiosk')).toHaveCount(0, { timeout: 5_000 });
});

test('a short tap does not trigger the exit', async ({ page }) => {
  await openKiosk(page);
  await dispatchExitPointerEvent(page, 'pointerdown');
  await page.waitForTimeout(150);
  await dispatchExitPointerEvent(page, 'pointerup');
  // Wait comfortably past the full hold duration to prove the tap didn't
  // somehow still complete it later.
  await page.waitForTimeout(3400);
  await expect(page.locator('#checkin-kiosk')).toHaveCount(1);
  // The progress bar must also have unwound back to empty, not be left
  // stranded mid-fill from the cancelled attempt.
  const width = await page.locator('#checkin-exit-progress').evaluate((el) => el.style.width);
  expect(width).toBe('0%');
});

test('a pointercancel before 3s aborts the hold', async ({ page }) => {
  await openKiosk(page);
  await dispatchExitPointerEvent(page, 'pointerdown');
  await page.waitForTimeout(1000);
  await dispatchExitPointerEvent(page, 'pointercancel');
  await page.waitForTimeout(2800); // past the original 3s mark
  await expect(page.locator('#checkin-kiosk')).toHaveCount(1);
});

test('a scroll mid-hold aborts it, even without a release event', async ({ page }) => {
  // Regression guard for the drift bug this fix addresses: a real finger
  // held for 3s is never perfectly still, and letting ambient page
  // movement complete (rather than cancel) the hold would be the exact
  // opposite of the intended fix.
  await openKiosk(page);
  await dispatchExitPointerEvent(page, 'pointerdown');
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await page.waitForTimeout(2800);
  await expect(page.locator('#checkin-kiosk')).toHaveCount(1);
});

test('a stray second pointer cannot cancel an in-flight hold', async ({ page }) => {
  // pointerId ownership guard: an unrelated pointerup/cancel for a
  // *different* pointerId than the one holding must not be able to
  // interrupt the real hold in progress.
  await openKiosk(page);
  await dispatchExitPointerEvent(page, 'pointerdown', 1);
  await page.waitForTimeout(500);
  await dispatchExitPointerEvent(page, 'pointercancel', 2); // different pointerId — must be ignored
  await page.waitForTimeout(2900); // total > 3000ms since the real pointerdown
  await dispatchExitPointerEvent(page, 'pointerup', 1);
  await expect(page.locator('#checkin-kiosk')).toHaveCount(0, { timeout: 5_000 });
});
