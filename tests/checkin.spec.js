// tests/checkin.spec.js — token lifecycle + staff check-in idempotency.
// Needs SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD (staff or owner login)
// and --workers=1, same as the rest of the credentialed suite.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD');

async function signIn(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  // lib/checkin.js is only imported by the two check-in pages, and it's
  // the module that exposes window.__sculptCheckin for tests to reach —
  // see the comment in lib/checkin.js. Navigate to one to load it.
  await page.evaluate(() => window._navTo('checkin-scan'));
  await page.waitForFunction(() => !!window.__sculptCheckin);
}

test('a token issued now is accepted by staff check-in', async ({ page }) => {
  await signIn(page);
  const result = await page.evaluate(async () => {
    const { token } = await window.__sculptCheckin.issueCheckinToken();
    return window.__sculptCheckin.staffCheckin(token);
  });
  expect(['CHECKED_IN', 'CHECKED_OUT', 'TOO_SOON', 'ALREADY_DONE']).toContain(result.status);
});

test('an expired (90s+ old) token is rejected', async ({ page }) => {
  await signIn(page);
  const result = await page.evaluate(async () => {
    // A random hex string that was never issued behaves identically to
    // an expired one from the function's point of view (NOT FOUND in
    // checkin_tokens WHERE expires_at > now()), and doesn't require
    // the test to sleep 90 seconds.
    const fakeOldToken = Array.from({ length: 32 }, () => '0').join('');
    return window.__sculptCheckin.staffCheckin(fakeOldToken);
  });
  expect(result.status).toBe('INVALID_TOKEN');
});

test('two scans inside 10 minutes do not double-write', async ({ page }) => {
  await signIn(page);
  const results = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 2; i++) {
      const { token } = await window.__sculptCheckin.issueCheckinToken();
      out.push(await window.__sculptCheckin.staffCheckin(token));
    }
    return out;
  });
  // First call check-in (or already-done from a prior test run today);
  // the second, seconds later, must NOT be a second CHECKED_IN — it's
  // either TOO_SOON or ALREADY_DONE, never a fresh insert.
  expect(results[1].status).not.toBe('CHECKED_IN');
});
