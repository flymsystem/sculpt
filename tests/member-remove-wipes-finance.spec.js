// tests/member-remove-wipes-finance.spec.js — Remove must erase a
// member's money from Finance too, in one step, no separate confirmation.
//
// History: migration 121 deliberately made revenue survive a member
// being soft-deleted (is_active=false), so a real member leaving the gym
// doesn't erase their historical revenue. During the 2026-08-27 client
// demo, three test/mistake entries were Removed and their payments kept
// showing in Finance — which read as "the app is broken" from the
// client's side. A first fix added a separate owner-only "Delete
// permanently" escalation with a typed DELETE confirmation, keeping
// Remove as the soft-delete default. The client rejected that shape
// outright ("I DONT NEED THAT TYPE DELETE THING... it should just
// delete the finance details of deleted member literally from
// everywhere") — so Remove itself now calls
// sculpt_delete_member_permanently (migration 129) directly. There is
// no more soft-delete option in the UI and no Undo.
//
// Needs SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD (owner login) and
// --workers=1, same as the rest of the credentialed suite.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD');

test('Remove wipes the member and their money everywhere, in one step, no typed confirmation', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await page.waitForFunction(() => typeof window._navTo === 'function');
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));

  await page.evaluate(() => window._navTo('finance'));
  await page.waitForSelector('#fin-rev-card');
  await page.locator('[data-fin-p="all"]').click();
  const revBefore = await page.locator('#fin-rev-card .finance-stat-val').innerText();

  // Add a real Paid member with a plan + payment through the real UI.
  await page.evaluate(() => window._navTo('members'));
  await page.waitForFunction(() => !!window.__sculptMembers);
  await page.locator('#btn-add-m').click();
  await page.waitForSelector('#m-name', { state: 'visible' });
  const name = 'E2E RemoveWipesFinance ' + Math.random().toString(36).slice(2, 8);
  const phone = String(9_000_000_000 + Math.floor(Math.random() * 99_999_999)).slice(0, 10);
  await page.locator('#m-name').fill(name);
  await page.locator('#m-phone').fill(phone);
  const planValue = await page.locator('#m-plan option').evaluateAll(
    (opts) => opts.find(o => /1 month/i.test(o.dataset.name || o.textContent))?.value
  );
  await page.locator('#m-plan').selectOption(planValue);
  await page.locator('#m-paid-now').fill('2000');
  await page.locator('#btn-add-submit').click();
  await expect(page.getByText('Member Added', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.locator('#modal-cancel').click();

  await page.evaluate(() => window._navTo('finance'));
  await page.waitForSelector('#fin-rev-card');
  await page.locator('[data-fin-p="all"]').click();
  const revAfterAdd = await page.locator('#fin-rev-card .finance-stat-val').innerText();
  expect(revAfterAdd, 'adding a paid member must raise revenue').not.toBe(revBefore);

  // Remove — a single modal, no typed-DELETE input, no separate escalation.
  await page.evaluate(() => window._navTo('members'));
  await page.waitForFunction(() => !!window.__sculptMembers);
  await page.locator('.member-row', { hasText: name }).first().click();
  await page.waitForSelector('#md-del-btn', { state: 'visible' });
  await page.locator('#md-del-btn').click();

  await page.waitForSelector('#btn-confirm-del', { state: 'visible' });
  await expect(page.locator('#md-hard-delete-confirm')).toHaveCount(0);
  await expect(page.locator('#md-hard-delete-link')).toHaveCount(0);
  await page.locator('#btn-confirm-del').click();
  await expect(page.getByText(name)).toHaveCount(0, { timeout: 10_000 });

  await page.evaluate(() => window._navTo('finance'));
  await page.waitForSelector('#fin-rev-card');
  await page.locator('[data-fin-p="all"]').click();
  const revAfterRemove = await page.locator('#fin-rev-card .finance-stat-val').innerText();
  expect(revAfterRemove, 'Remove must put revenue back to what it was before the payment').toBe(revBefore);
});
