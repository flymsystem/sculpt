// tests/add-member.spec.js — Add Member, end to end, through the real
// dashboard UI (not a direct RPC call). Every add-member bug found in
// the last two days was in this exact path and nothing exercised it
// before now: migration 104's sculpt_add_member calling a helper name
// that no longer existed (114_fix_add_member_stale_helper_call.sql),
// and the FIX-PROMPT.md report of "the sculpt_add_member database
// function does not exist" pointing at the wrong function entirely.
//
// Needs SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD (owner login) and
// --workers=1, same as the rest of the credentialed suite.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD');

test('adding a member through the dashboard saves it with an application number', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  // window._navTo is assigned synchronously on module load, well before
  // renderGymDashboard's own `await loadData()` resolves and calls its
  // initial nav(initialSection) — calling _navTo('members') in that gap
  // renders Members, then the trailing automatic nav (back to 'overview',
  // since the URL was bare /dashboard) immediately overwrites it, and
  // #btn-add-m vanishes mid-test. Waiting for the FIRST real render
  // (any .content-inner under #gym-content) means that automatic nav has
  // already happened, so this call is the last one, not a race.
  await page.waitForFunction(() => typeof window._navTo === 'function');
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));
  await page.evaluate(() => window._navTo('members'));
  await page.waitForFunction(() => !!window.__sculptMembers);

  await page.locator('#btn-add-m').click();
  await page.waitForSelector('#m-name', { state: 'visible' });

  const name = 'E2E AddMember ' + Math.random().toString(36).slice(2, 8);
  await page.locator('#m-name').fill(name);
  // Phone is required (FIX-PROMPT.md item 1) — a random 10-digit number
  // keeps this test independent of any real member's phone.
  await page.locator('#m-phone').fill(String(9_000_000_000 + Math.floor(Math.random() * 99_999_999)).slice(0, 10));
  // Trial members skip plan selection and payment entirely — the
  // smallest surface that still exercises the real sculpt_add_member
  // RPC (join date, application-number generation, RLS as the owner).
  await page.locator('#mt-trial').click();
  await page.locator('#btn-add-submit').click();

  // openAddSuccessModal only ever renders when saved.application_number
  // is truthy — this is the real assertion: a NULL/missing application
  // number (the exact regression this suite exists to catch) means this
  // modal never appears and the test times out here.
  const successModal = page.getByText('Member Added', { exact: true });
  await expect(successModal).toBeVisible({ timeout: 15_000 });

  const modalText = await page.locator('#sculpt-modal-overlay').textContent();
  const appNumber = modalText?.match(/SC-\d{4}-[A-Z0-9]{3}/)?.[0];
  expect(appNumber, `No application number found in modal text: ${modalText}`).toBeTruthy();

  await page.locator('#modal-cancel').click();

  // Cleanup — don't leave the test member in the gym's real member list.
  await page.evaluate(async (n) => {
    const gymId = window.__sculptSession.gym.id;
    const members = await window.__sculptMembers.getMembers(gymId);
    for (const m of members.filter((x) => x.full_name === n)) {
      await window.__sculptMembers.deleteMemberPermanently(m.id, gymId).catch(() => {});
    }
  }, name);
});
