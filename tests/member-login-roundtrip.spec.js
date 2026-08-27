// tests/member-login-roundtrip.spec.js — add a member through the real
// dashboard UI, then sign in as that member through the real
// member-login screen. This is the exact path that failed for a real
// member during the 2026-08-27 client demo.
//
// Root cause (proven against production, not guessed — see
// HANDOVER.md's 2026-08-27 entry and supabase/migrations/README.md's
// migration 130 entry): src/lib/member-auth.js hardcoded
// GYM_CODE = 'SCULPT01', but production's actual gyms.gym_code is
// 'DSCULPT' — every member login failed at the gym-lookup step inside
// member-signin/index.ts, for every member, regardless of that member's
// own data. member_login_attempts confirmed every attempt during the
// demo had gym_id = null. Fixed by correcting the constant and adding a
// live assertion in scripts/verify-schema.mjs so it can't drift silently
// again.
//
// This test exercises the full path end to end — real add-member RPC,
// real member-signin Edge Function call, real RLS as the resulting
// member session — rather than asserting on the GYM_CODE constant
// directly, so it would have caught the actual demo failure regardless
// of which of the five member-signin rejection paths was the cause.
//
// Needs SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD (owner login) and
// --workers=1, same as the rest of the credentialed suite.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD');

test('a member added through the dashboard can sign in through member-login', async ({ page, browser }) => {
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await page.waitForFunction(() => typeof window._navTo === 'function');
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));
  await page.evaluate(() => window._navTo('members'));
  await page.waitForFunction(() => !!window.__sculptMembers);

  await page.locator('#btn-add-m').click();
  await page.waitForSelector('#m-name', { state: 'visible' });

  const name = 'E2E LoginRoundTrip ' + Math.random().toString(36).slice(2, 8);
  const phone = String(9_000_000_000 + Math.floor(Math.random() * 99_999_999)).slice(0, 10);
  await page.locator('#m-name').fill(name);
  await page.locator('#m-phone').fill(phone);
  await page.locator('#mt-trial').click();
  await page.locator('#btn-add-submit').click();

  const successModal = page.getByText('Member Added', { exact: true });
  await expect(successModal).toBeVisible({ timeout: 15_000 });
  const modalText = await page.locator('#sculpt-modal-overlay').textContent();
  const appNumber = modalText?.match(/SC-\d{4}-[A-Z0-9]{3}/)?.[0];
  expect(appNumber, `No application number found in modal text: ${modalText}`).toBeTruthy();
  await page.locator('#modal-cancel').click();

  // Sign in as the member in a genuinely separate browser context — not
  // context.newPage(), which shares the owner's session/cookies within
  // the same context and made this test hang: navigating a still-
  // authenticated-as-owner tab to /member/login just bounces straight
  // back to /dashboard via the app's own boot() redirect, so
  // #member-appnum never renders. A fresh context has no session at all,
  // exactly like a member's own device.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto('/member/login', { waitUntil: 'load' });
  await memberPage.locator('#member-appnum').fill(appNumber);
  await memberPage.locator('#member-phone').fill(phone);
  await memberPage.locator('#member-login-submit').click();

  // Lands on the member portal, not still on the login screen with an
  // error. /member (exactly, no trailing /login) is where
  // renderMemberPortal mounts — PAGE_TO_PATH in app.js.
  await expect(memberPage).toHaveURL(/\/member$/, { timeout: 15_000 });
  await memberContext.close();

  // Cleanup — don't leave the test member in the gym's real member list.
  await page.evaluate(async (n) => {
    const gymId = window.__sculptSession.gym.id;
    const members = await window.__sculptMembers.getMembers(gymId);
    for (const m of members.filter((x) => x.full_name === n)) {
      await window.__sculptMembers.deleteMemberPermanently(m.id, gymId).catch(() => {});
    }
  }, name);
});
