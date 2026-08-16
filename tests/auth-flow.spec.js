// tests/auth-flow.spec.js
//
// The one test that proves the whole stack is wired together: the built
// frontend, the Supabase project, and the seeded owner account.
//
// Credentials come from the environment so they are never committed. Run:
//   SCULPT_TEST_EMAIL=... SCULPT_TEST_PASSWORD=... npx playwright test

import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD not set');

// Serial, not parallel. Every test here signs in, and four simultaneous
// sign-ins from one IP trip Supabase's auth rate limit — which fails as a
// login timeout and reads like a broken app rather than a throttled one.
test.describe.configure({ mode: 'serial' });

async function login(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test('owner can log in and the dashboard renders', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  await login(page);

  await expect(page.locator('#gym-content')).not.toBeEmpty();
  await expect(page.getByText('D Sculpt Fitness').first()).toBeVisible();
  expect(jsErrors, 'Uncaught JS error on the dashboard').toEqual([]);
});

// Overview is the section most at risk: unwinding the analytics tier gate
// meant surgery on a nested template literal, and nothing had rendered it
// before there was a database to log into.
test('every dashboard section renders without a JS error', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  await login(page);

  const sections = [
    'overview', 'members', 'enquiries', 'alerts', 'staff',
    'finance', 'expenses', 'plans', 'plans-showcase', 'gymconfig',
    'backup', 'analytics',
  ];

  for (const s of sections) {
    await page.evaluate((id) => window._navTo(id), s);
    await page.waitForTimeout(350);
    await expect(page.locator('#gym-content'), `section ${s} rendered empty`).not.toBeEmpty();
  }

  expect(jsErrors, `Uncaught JS error while walking dashboard sections`).toEqual([]);
});

test('the revenue RPCs resolve — the sculpt_* rename landed on both sides', async ({ page }) => {
  // Watches the network rather than reaching into module internals: the
  // built bundle has hashed filenames, so importing a source path fails.
  //
  // Finance calls sculpt_revenue_summary / _monthly / _rows on render. If
  // the rename had landed on only one side, PostgREST would answer 404
  // PGRST202 and the client would quietly drop to its slower client-side
  // fallback — working, but not what we shipped. Asserting on the wire
  // catches that; asserting on the screen would not.
  const rpcCalls = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('/rest/v1/rpc/')) return;
    rpcCalls.push({ name: u.split('/rpc/')[1].split('?')[0], status: res.status() });
  });

  await login(page);
  await page.evaluate(() => window._navTo('finance'));
  await page.waitForTimeout(2500);

  const revenue = rpcCalls.filter(c => c.name.startsWith('sculpt_revenue'));
  expect(revenue.length, `Finance called no revenue RPC. Saw: ${JSON.stringify(rpcCalls)}`)
    .toBeGreaterThan(0);

  const missing = revenue.filter(c => c.status === 404);
  expect(missing, `revenue RPC not found on the server: ${JSON.stringify(missing)}`).toEqual([]);

  // And nothing should still be calling the old names.
  expect(rpcCalls.filter(c => c.name.startsWith('flym_'))).toEqual([]);
});

test('no superadmin surface is reachable once logged in', async ({ page }) => {
  await login(page);

  await page.goto('/admin', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();

  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body).not.toContain('all gyms');
  expect(body).not.toContain('superadmin');
  expect(body).not.toContain('onboard gym');
});
