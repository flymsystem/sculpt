// tests/staff-login-management.spec.js — owner-only staff login
// management (Part 3 of the staff-accounts work): creating a login end
// to end through the real dashboard UI, a deactivated staff member
// losing sign-in access, and a staff account being unable to manage
// another staff member's login even by calling the underlying function
// directly (not just via a hidden button).
//
// Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD (owner) for every test,
// and SCULPT_STAFF_EMAIL/SCULPT_STAFF_PASSWORD (a real staff login) for
// the last one. --workers=1, serial — these hand a disposable staff
// account's login credentials back and forth between an owner session
// (to create/inspect it) and the staff account itself (to attempt
// sign-in), so a second test starting mid-handoff would race the first.
import { test, expect } from '@playwright/test';

const OWNER_EMAIL = process.env.SCULPT_TEST_EMAIL;
const OWNER_PASSWORD = process.env.SCULPT_TEST_PASSWORD;
const STAFF_EMAIL = process.env.SCULPT_STAFF_EMAIL;
const STAFF_PASSWORD = process.env.SCULPT_STAFF_PASSWORD;

test.skip(!OWNER_EMAIL || !OWNER_PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD');
test.describe.configure({ mode: 'serial' });

function randomSuffix() { return Math.random().toString(36).slice(2, 8); }

async function signInOwner(page) {
  // If a DIFFERENT session (e.g. the staff account this file switches
  // to) is still active, boot() (src/app.js) redirects /login straight
  // back to that account's dashboard on every navigation, so
  // #login-email never appears and this hangs until timeout. Sign out
  // for real first — same reason as security.spec.js's signInOwner.
  const logoutBtn = page.locator('#topbar-logout-btn');
  if (await logoutBtn.count()) {
    await logoutBtn.click();
    await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 10_000 }).catch(() => {});
  }
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(OWNER_EMAIL);
  await page.locator('#login-pass').fill(OWNER_PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await page.waitForFunction(() => typeof window._navTo === 'function');
  // See tests/add-member.spec.js: the dashboard's own initial nav can
  // stomp a nav triggered before loadData() resolves. Wait for the first
  // real render so this call is the last one, not a race.
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));
  await page.evaluate(() => window._navTo('staff'));
  await page.waitForFunction(() => !!window.__sculptStaff && !!window.__sculptStaffAuth);
}

// Goes through the real Add Staff modal (not the window.__sculptStaff
// hook directly) specifically so the in-page S.staff state and DOM stay
// in sync afterward — the hook writes straight to the database and the
// dashboard would never learn about the new row without a full reload.
async function createDisposableStaff(page, name) {
  await page.locator('#btn-add-staff').click();
  await page.waitForSelector('#stf-name', { state: 'visible' });
  await page.locator('#stf-name').fill(name);
  await page.locator('#btn-stf-submit').click();
  await expect(page.locator('#sculpt-modal-overlay')).toHaveCount(0, { timeout: 15_000 });

  const staffId = await page.evaluate(async (n) => {
    const gymId = window.__sculptSession.gym.id;
    const list = await window.__sculptStaff.getStaff(gymId);
    return list.find((s) => s.full_name === n)?.id;
  }, name);
  expect(staffId, `Newly-added staff "${name}" was not found after saving`).toBeTruthy();
  return { id: staffId };
}

async function cleanupStaff(page, staffId) {
  await page.evaluate(async (id) => {
    const gymId = window.__sculptSession.gym.id;
    await window.__sculptStaffAuth.removeStaffLogin(id).catch(() => {});
    await window.__sculptStaff.deleteStaff(id, gymId).catch(() => {});
  }, staffId).catch(() => {});
}

test('creating a staff login through the dashboard end to end', async ({ page }) => {
  await signInOwner(page);
  const name = 'E2E Login ' + randomSuffix();
  const staff = await createDisposableStaff(page, name);

  try {
    const row = page.locator('#staff-tbody tr', { hasText: name });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.locator('[data-staff-login]').click();

    await page.waitForSelector('#sl-email', { state: 'visible' });
    const email = `e2e.${randomSuffix()}@example.com`;
    await page.locator('#sl-email').fill(email);
    await page.locator('#sl-password').fill('e2eTestPass123');
    await page.locator('#sl-submit').click();

    await expect(page.getByText('Login created for', { exact: false })).toBeVisible({ timeout: 15_000 });

    // The row now shows the Manage Login button (gear icon) instead of
    // Create Login, and a green "Login" badge — the real proof the
    // account exists, not just that the toast said so.
    const manageBtn = row.locator('[data-staff-manage-login]');
    await expect(manageBtn).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('Login');
  } finally {
    await cleanupStaff(page, staff.id);
  }
});

test('a deactivated staff member cannot sign in', async ({ page }) => {
  await signInOwner(page);
  const name = 'E2E Deactivated ' + randomSuffix();
  const staff = await createDisposableStaff(page, name);
  const email = `e2e.deactivated.${randomSuffix()}@example.com`;
  const password = 'e2eTestPass123';

  try {
    const created = await page.evaluate(async ({ staffId, email, password }) => {
      return window.__sculptStaffAuth.createStaffLogin(staffId, email, password);
    }, { staffId: staff.id, email, password });
    expect(created.email).toBe(email);

    // Deactivate — the app's normal soft-delete action (deleteStaff sets
    // staff.is_active = false). This alone must revoke the login: see
    // 115_staff_login_revocation.sql and the login_enabled/is_active
    // check added to getMyProfile() in src/lib/auth.js.
    await page.evaluate(async (staffId) => {
      const gymId = window.__sculptSession.gym.id;
      await window.__sculptStaff.deleteStaff(staffId, gymId);
    }, staff.id);

    // Sign out the owner and attempt to sign in as the now-deactivated
    // staff member — this is the real end-to-end check, through the
    // actual login form, not just an RLS query. Clearing the JS-level
    // window.__sculptSession alone is not enough: the real Supabase
    // auth session survives in localStorage, and boot() (src/app.js)
    // reads that on every navigation — a stale owner session would
    // make /login redirect straight back to /dashboard, so
    // #login-email never appears and this hangs until timeout. Click
    // the real Sign Out button so both layers actually clear, the same
    // way an owner really would.
    await page.locator('#topbar-logout-btn').click();
    await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await page.goto('/login', { waitUntil: 'load' });
    await page.locator('#login-email').fill(email);
    await page.locator('#login-pass').fill(password);
    await page.locator('#login-submit').click();

    // getMyProfile() throws "Your staff account has been disabled" and
    // signs the session back out — must never reach /dashboard.
    await page.waitForTimeout(3000);
    expect(page.url(), 'A deactivated staff login reached the dashboard').not.toContain('/dashboard');
  } finally {
    await signInOwner(page);
    await cleanupStaff(page, staff.id);
  }
});

test('a staff user cannot manage another staff member\'s login', async ({ page }) => {
  test.skip(!STAFF_EMAIL || !STAFF_PASSWORD, 'Needs SCULPT_STAFF_EMAIL/SCULPT_STAFF_PASSWORD');

  await signInOwner(page);
  const name = 'E2E Victim ' + randomSuffix();
  const staff = await createDisposableStaff(page, name);
  const email = `e2e.victim.${randomSuffix()}@example.com`;

  try {
    await page.evaluate(async ({ staffId, email, password }) => {
      return window.__sculptStaffAuth.createStaffLogin(staffId, email, password);
    }, { staffId: staff.id, email, password: 'e2eTestPass123' });

    // Switch to a real staff session and try to disable the OTHER
    // staff member's login directly through the same function the
    // owner's UI calls — this must be rejected server-side (manage-
    // staff-login checks gym_users.role = 'owner' on every call), not
    // merely hidden by not rendering the button. See the deactivated-
    // staff test above for why a real Sign Out (not just clearing the
    // JS session marker) is required before this navigation.
    await page.locator('#topbar-logout-btn').click();
    await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await page.goto('/login', { waitUntil: 'load' });
    await page.locator('#login-email').fill(STAFF_EMAIL);
    await page.locator('#login-pass').fill(STAFF_PASSWORD);
    await page.locator('#login-submit').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await page.waitForFunction(() => typeof window._navTo === 'function');
    await page.evaluate(() => window._navTo('staff'));
    await page.waitForFunction(() => !!window.__sculptStaffAuth);

    const result = await page.evaluate(async (staffId) => {
      try {
        await window.__sculptStaffAuth.disableStaffLogin(staffId);
        return { blocked: false };
      } catch (err) {
        return { blocked: true, message: err.message };
      }
    }, staff.id);

    expect(result.blocked, 'A staff session was able to disable another staff member\'s login').toBe(true);
    expect(result.message).toMatch(/owner|forbidden/i);
  } finally {
    await signInOwner(page);
    await cleanupStaff(page, staff.id);
  }
});
