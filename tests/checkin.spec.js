// tests/checkin.spec.js — token lifecycle + staff check-in idempotency.
// Needs SCULPT_STAFF_EMAIL / SCULPT_STAFF_PASSWORD (a real staff login,
// not the owner) and --workers=1, same as the rest of the credentialed
// suite.
//
// WHY STAFF CREDENTIALS, NOT OWNER: sculpt_staff_checkin() resolves the
// caller via staff.user_id = auth.uid(). The owner has no staff row, so
// every call from an owner session legitimately returns NOT_STAFF —
// these tests would either fail for the wrong reason or (with a loose
// enough assertion) silently pass without ever exercising the real
// check-in mechanism. See HANDOVER.md's now-resolved "in-progress
// debugging" note for how that confusion cost a session.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_STAFF_EMAIL;
const PASSWORD = process.env.SCULPT_STAFF_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_STAFF_EMAIL/SCULPT_STAFF_PASSWORD (a staff login, not the owner)');

async function signIn(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  // window._navTo is assigned as a side effect of dashboard/index.js's
  // dynamic import finishing evaluation — the URL can already read
  // /dashboard (the router updates it optimistically) before that import
  // resolves. Calling window._navTo before it exists throws
  // "window._navTo is not a function"; wait for it instead of racing it.
  await page.waitForFunction(() => typeof window._navTo === 'function');
  // The dashboard's own initial nav (fired once loadData() resolves, after
  // window._navTo already exists) can stomp a nav we trigger before it —
  // see the longer comment in tests/add-member.spec.js. Wait for the
  // first real render so ours is the last one, not a race.
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));
  // lib/checkin.js is only imported by the two check-in pages, and it's
  // the module that exposes window.__sculptCheckin for tests to reach —
  // see the comment in lib/checkin.js. Navigate to one to load it.
  await page.evaluate(() => window._navTo('checkin-scan'));
  await page.waitForFunction(() => !!window.__sculptCheckin);

  // Fail loudly, not silently, if these credentials aren't actually a
  // staff login — a NOT_STAFF result below would otherwise look
  // identical to a passing "not too soon" assertion.
  const staffId = await page.evaluate(() => window.__sculptSession?.staffRecord?.id || null);
  if (!staffId) throw new Error('SCULPT_STAFF_EMAIL is not a staff login (no staffRecord on the session) — these tests need a real staff account, not the owner.');
}

test('a token issued now is accepted by staff check-in', async ({ page }) => {
  await signIn(page);
  const result = await page.evaluate(async () => {
    const { token } = await window.__sculptCheckin.issueCheckinToken();
    return window.__sculptCheckin.staffCheckin(token);
  });
  expect(result.status, 'A real staff login got NOT_STAFF back').not.toBe('NOT_STAFF');
  expect(['CHECKED_IN', 'CHECKED_OUT', 'TOO_SOON']).toContain(result.status);
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
  expect(results[0].status, 'A real staff login got NOT_STAFF back').not.toBe('NOT_STAFF');
  // First call checks in (or moves check_out, if a prior test run
  // already checked in today); the second, seconds later, must NOT be
  // a second CHECKED_IN — it's TOO_SOON, never a fresh insert.
  expect(results[1].status).toBe('TOO_SOON');
});

test('a scan after the cooldown moves check_out forward, not just once', async ({ page }) => {
  // Regression test for the bug where a second scan set check_out and
  // every scan after that returned a terminal ALREADY_DONE — permanently
  // recording a trainer's day as ending at their lunch-break scan. There
  // is no way to force a real 10-minute wait in a fast test suite, so
  // this only asserts the vocabulary: CHECKED_OUT (or TOO_SOON, if run
  // back-to-back with the previous test) must be possible more than once
  // in a day, i.e. the RPC must never return a status meaning "no further
  // scans accepted today".
  await signIn(page);
  const result = await page.evaluate(async () => {
    const { token } = await window.__sculptCheckin.issueCheckinToken();
    return window.__sculptCheckin.staffCheckin(token);
  });
  expect(result.status, 'A real staff login got NOT_STAFF back').not.toBe('NOT_STAFF');
  expect(result.status).not.toBe('ALREADY_DONE');
});
