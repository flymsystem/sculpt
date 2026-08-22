// tests/_diag-checkin-token.spec.js — TEMPORARY diagnostic, not part of the
// suite. Captures the exact HTTP status + body of the RPC calls involved
// in the two open bugs:
//   1. sculpt_add_member — why application_number keeps landing NULL
//   2. sculpt_issue_checkin_token / sculpt_staff_checkin — why
//      checkin.spec.js:24 and :33 still fail after migration 111
// Delete once both are confirmed fixed.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD');

function watchRpc(page, calls, name) {
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes(`/rpc/${name}`)) return;
    let body = '';
    try { body = await res.text(); } catch (_) { body = '<unreadable>'; }
    calls.push({ status: res.status(), statusText: res.statusText(), body });
  });
}

test('diag: capture the real sculpt_issue_checkin_token / sculpt_staff_checkin responses', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  const issueCalls = [];
  const staffCalls = [];
  watchRpc(page, issueCalls, 'sculpt_issue_checkin_token');
  watchRpc(page, staffCalls, 'sculpt_staff_checkin');

  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  await page.evaluate(() => window._navTo('checkin-scan'));
  await page.waitForFunction(() => !!window.__sculptCheckin);

  const issueResult = await page.evaluate(async () => {
    try {
      const r = await window.__sculptCheckin.issueCheckinToken();
      return { ok: true, r };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  let staffResult = null;
  if (issueResult.ok) {
    staffResult = await page.evaluate(async (token) => {
      try {
        const r = await window.__sculptCheckin.staffCheckin(token);
        return { ok: true, r };
      } catch (err) {
        return { ok: false, message: err.message };
      }
    }, issueResult.r.token);
  }

  // Same fake-token check as checkin.spec.js:33
  const fakeTokenResult = await page.evaluate(async () => {
    try {
      const fakeToken = Array.from({ length: 32 }, () => '0').join('');
      const r = await window.__sculptCheckin.staffCheckin(fakeToken);
      return { ok: true, r };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  console.log('=== CONSOLE ERRORS ===');
  console.log(JSON.stringify(consoleErrors, null, 2));
  console.log('=== issueCheckinToken() JS-level result ===');
  console.log(JSON.stringify(issueResult, null, 2));
  console.log('=== staffCheckin(realToken) JS-level result ===');
  console.log(JSON.stringify(staffResult, null, 2));
  console.log('=== staffCheckin(fakeToken) JS-level result ===');
  console.log(JSON.stringify(fakeTokenResult, null, 2));
  console.log('=== sculpt_issue_checkin_token RAW RPC responses ===');
  console.log(JSON.stringify(issueCalls, null, 2));
  console.log('=== sculpt_staff_checkin RAW RPC responses ===');
  console.log(JSON.stringify(staffCalls, null, 2));

  expect(true).toBe(true); // this test exists to print evidence, not assert
});

test('diag: capture the real sculpt_add_member response and returned application_number', async ({ page }) => {
  const addMemberCalls = [];
  watchRpc(page, addMemberCalls, 'sculpt_add_member');

  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  await page.evaluate(() => window._navTo('members'));
  await page.waitForFunction(() => !!window.__sculptMembers);

  const result = await page.evaluate(async () => {
    const gymId = window.__sculptSession.gym.id;
    const phone = String(9_000_000_000 + Math.floor(Math.random() * 900_000_000));
    try {
      const saved = await window.__sculptMembers.addMember(gymId, {
        fullName: 'DiagAppNum ' + Math.random().toString(36).slice(2, 8),
        phone,
        joinDate: new Date().toISOString().split('T')[0],
        planDurationMonths: 12,
        planName: 'Diag Plan',
        planPrice: 0,
        memberType: 'Paid',
        paymentStatus: 'Paid',
        amountPaidNow: 0,
      });
      return { ok: true, id: saved.id, application_number: saved.application_number, fullRow: saved };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  console.log('=== addMember() JS-level result ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('=== sculpt_add_member RAW RPC responses ===');
  console.log(JSON.stringify(addMemberCalls, null, 2));

  // Cleanup — don't leave the diagnostic member behind.
  if (result.ok && result.id) {
    await page.evaluate(async (id) => {
      const gymId = window.__sculptSession.gym.id;
      await window.__sculptMembers.deleteMember(id, gymId).catch(() => {});
    }, result.id);
  }

  expect(true).toBe(true); // this test exists to print evidence, not assert
});
