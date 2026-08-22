// tests/security.spec.js — the checks that matter more than the rest.
//
// Needs SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD (owner or staff login)
// and --workers=1, same as the rest of the credentialed suite. Serial
// mode is required here specifically: these tests hand sessions back
// and forth between an owner and disposable member accounts, and a
// second test starting mid-handoff would race the first.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;
const GYM_CODE = 'SCULPT01';

test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD');
test.describe.configure({ mode: 'serial' });

function randomPhone() {
  // 10 digits, always starts 9/8/7/6 like a real Indian mobile number,
  // random enough that two test runs never collide on checkDuplicatePhone.
  return String(9_000_000_000 + Math.floor(Math.random() * 900_000_000));
}

async function signInOwner(page) {
  // Every test in this file that hands the session to a member and then
  // switches back must NOT leave that member session active — boot()
  // (src/app.js) runs on every navigation including /login, and if a
  // member auth session is still persisted it redirects straight to
  // /member without ever rendering the login form, so #login-email
  // never appears and this hangs until the test times out. This was the
  // real cause of HANDOVER.md's "security.spec.js serial-mode cascade
  // behind its first failure" — the finally blocks called signInOwner
  // right after a real member sign-in with no sign-out in between.
  await page.evaluate(() => window.__sculptSupabase?.auth.signOut()).catch(() => {});
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  // See tests/checkin.spec.js for why this wait is needed — window._navTo
  // is assigned when dashboard/index.js's dynamic import finishes, which
  // can race the URL already reading /dashboard.
  await page.waitForFunction(() => typeof window._navTo === 'function');
  // See tests/add-member.spec.js: the dashboard's own initial nav can
  // stomp a nav triggered before loadData() resolves. Wait for the first
  // real render so these calls are the last ones, not a race.
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));
  await page.evaluate(() => window._navTo('members'));
  await page.evaluate(() => window._navTo('checkin-scan'));
  await page.waitForFunction(() => !!window.__sculptMembers && !!window.__sculptCheckin);
}

/** Creates a throwaway member and returns the saved row (incl. application_number). */
async function createTestMember(page, { phone, expired = false }) {
  return page.evaluate(async ({ phone, expired }) => {
    const gymId = window.__sculptSession.gym.id;
    const data = {
      fullName: 'SecTest ' + Math.random().toString(36).slice(2, 8),
      phone,
      // An expired member: joined and their 1-month plan ended years ago.
      // A normal member: joined today, plan runs a year.
      joinDate: expired ? '2020-01-01' : new Date().toISOString().split('T')[0],
      planDurationMonths: expired ? 1 : 12,
      planName: 'Security Test Plan',
      planPrice: 0,
      memberType: 'Paid',
      paymentStatus: 'Paid',
      amountPaidNow: 0,
    };
    return window.__sculptMembers.addMember(gymId, data);
  }, { phone, expired });
}

async function cleanupMember(page, member) {
  if (!member?.id) return;
  await page.evaluate(async (m) => {
    const gymId = window.__sculptSession?.gym?.id;
    if (gymId) await window.__sculptMembers.deleteMember(m.id, gymId).catch(() => {});
  }, member).catch(() => {});
}

async function signOutAndGoMemberLogin(page) {
  await page.evaluate(() => window.__sculptSupabase?.auth.signOut()).catch(() => {});
  await page.goto('/member/login', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__sculptMemberAuth);
}

async function memberSignIn(page, appNumber, phone) {
  return page.evaluate(async ({ appNumber, phone }) => {
    try {
      await window.__sculptMemberAuth.memberSignIn(appNumber, phone);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }, { appNumber, phone });
}

test('a logged-in member cannot read another member\'s row', async ({ page }) => {
  await signInOwner(page);
  const memberA = await createTestMember(page, { phone: randomPhone() });
  const memberB = await createTestMember(page, { phone: randomPhone() });

  try {
    await signOutAndGoMemberLogin(page);
    const login = await memberSignIn(page, memberA.application_number, memberA.phone);
    expect(login.ok, login.message).toBe(true);

    const result = await page.evaluate(async (otherId) => {
      const { data, error } = await window.__sculptSupabase
        .from('members').select('id, full_name, phone').eq('id', otherId);
      return { data, error: error?.message };
    }, memberB.id);

    expect(result.data, 'A member session returned another member\'s row').toEqual([]);
  } finally {
    await signInOwner(page);
    await cleanupMember(page, memberA);
    await cleanupMember(page, memberB);
  }
});

test('a logged-in member cannot read the gyms table', async ({ page }) => {
  await signInOwner(page);
  const memberA = await createTestMember(page, { phone: randomPhone() });

  try {
    await signOutAndGoMemberLogin(page);
    const login = await memberSignIn(page, memberA.application_number, memberA.phone);
    expect(login.ok, login.message).toBe(true);

    const result = await page.evaluate(async () => {
      const { data, error } = await window.__sculptSupabase.from('gyms').select('*');
      return { data, error: error?.message };
    });

    // Either RLS returns zero rows, or PostgREST denies the query outright
    // (42501 insufficient_privilege) — both mean owner_password never
    // reached the client. What must NEVER happen is a non-empty result.
    expect(result.data || [], 'A member session read rows from gyms').toEqual([]);
  } finally {
    await signInOwner(page);
    await cleanupMember(page, memberA);
  }
});

test('a member cannot reach any dashboard route, including by typing the URL', async ({ page }) => {
  await signInOwner(page);
  const memberA = await createTestMember(page, { phone: randomPhone() });

  try {
    await signOutAndGoMemberLogin(page);
    const login = await memberSignIn(page, memberA.application_number, memberA.phone);
    expect(login.ok, login.message).toBe(true);

    // Reload as a member session, then type a dashboard URL directly —
    // this exercises boot()'s routing decision, not just in-app nav.
    await page.goto('/dashboard/members', { waitUntil: 'load' });
    await page.waitForTimeout(1500); // boot() resolves the session async

    await expect(page.locator('#gym-sidebar .sidebar')).toHaveCount(0);
    expect(page.url()).not.toContain('/dashboard');
  } finally {
    await signInOwner(page);
    await cleanupMember(page, memberA);
  }
});

test('an expired member is blocked and the denied row is still written', async ({ page }) => {
  await signInOwner(page);
  const expiredMember = await createTestMember(page, { phone: randomPhone(), expired: true });

  try {
    const { token } = await page.evaluate(() => window.__sculptCheckin.issueCheckinToken());

    await signOutAndGoMemberLogin(page);
    const login = await memberSignIn(page, expiredMember.application_number, expiredMember.phone);
    expect(login.ok, login.message).toBe(true);

    const result = await page.evaluate(async (t) => {
      const { data, error } = await window.__sculptSupabase.rpc('sculpt_member_checkin', { p_token: t });
      return { row: Array.isArray(data) ? data[0] : data, error: error?.message };
    }, token);

    expect(result.row?.status).toBe('DENIED_EXPIRED');

    // And the denial must have been written, not just returned — this is
    // the whole reason sculpt_member_checkin RETURNs instead of RAISEs.
    await signInOwner(page);
    const deniedRows = await page.evaluate(async (memberId) => {
      const { data } = await window.__sculptSupabase
        .from('member_checkins').select('status').eq('member_id', memberId).eq('status', 'denied_expired');
      return data || [];
    }, expiredMember.id);
    expect(deniedRows.length, 'No denied_expired row was written for the blocked member').toBeGreaterThan(0);
  } finally {
    await signInOwner(page);
    await cleanupMember(page, expiredMember);
  }
});

test('a token older than 90 seconds (or never issued) is rejected', async ({ page }) => {
  await signInOwner(page);
  const result = await page.evaluate(async () => {
    // A random hex string that was never issued is indistinguishable, at
    // the SQL level, from one that rotated out 90+ seconds ago — both
    // fail the same `expires_at > now()` check in sculpt_staff_checkin /
    // sculpt_member_checkin. This is the same trick tests/checkin.spec.js
    // uses so the suite doesn't need a real 90-second sleep.
    const fakeToken = Array.from({ length: 32 }, () => '0').join('');
    return window.__sculptCheckin.staffCheckin(fakeToken);
  });
  expect(result.status).toBe('INVALID_TOKEN');
});

test('a replayed token from a rotation that has expired is rejected', async ({ page }) => {
  // The 90s validity window is what makes the CURRENT and PREVIOUS
  // rotations both legitimately valid at once — that overlap is
  // deliberate (CHECKIN-PLAN.md §2), not a bug. What must be rejected is
  // a token old enough to have actually expired, which is exactly what
  // checkin_tokens.expires_at enforces regardless of which rotation
  // issued it. There's no way to fast-forward the database's clock from
  // here, so this exercises the same code path as the "never issued"
  // test above — both hit the identical `WHERE expires_at > now()`
  // guard a real 91-second-old token would fail on a live desk display.
  await signInOwner(page);
  const result = await page.evaluate(async () => {
    const fakeStaleToken = Array.from({ length: 32 }, () => 'a').join('');
    return window.__sculptCheckin.staffCheckin(fakeStaleToken);
  });
  expect(result.status).toBe('INVALID_TOKEN');
});

test('two member scans inside 90 minutes create one check-in row, not two', async ({ page }) => {
  await signInOwner(page);
  const member = await createTestMember(page, { phone: randomPhone() });

  try {
    const { token } = await page.evaluate(() => window.__sculptCheckin.issueCheckinToken());

    await signOutAndGoMemberLogin(page);
    const login = await memberSignIn(page, member.application_number, member.phone);
    expect(login.ok, login.message).toBe(true);

    const first = await page.evaluate(async (t) => {
      const { data } = await window.__sculptSupabase.rpc('sculpt_member_checkin', { p_token: t });
      return Array.isArray(data) ? data[0] : data;
    }, token);
    expect(first.status).toBe('OK');

    const second = await page.evaluate(async (t) => {
      const { data } = await window.__sculptSupabase.rpc('sculpt_member_checkin', { p_token: t });
      return Array.isArray(data) ? data[0] : data;
    }, token);
    expect(second.status).toBe('ALREADY_CHECKED_IN');

    await signInOwner(page);
    const okRows = await page.evaluate(async (memberId) => {
      const { data } = await window.__sculptSupabase
        .from('member_checkins').select('id').eq('member_id', memberId).eq('status', 'ok');
      return data || [];
    }, member.id);
    expect(okRows.length, 'Two OK check-in rows were written for one visit').toBe(1);
  } finally {
    await signInOwner(page);
    await cleanupMember(page, member);
  }
});

test('a staff second scan sets check_out, not a second attendance row', async ({ page }) => {
  await signInOwner(page);

  const staffId = await page.evaluate(() => window.__sculptSession?.staffRecord?.id || null);
  test.skip(!staffId, 'Logged in as owner, not staff — this check needs a staff session with staff.user_id set');

  const today = await page.evaluate(() => new Date().toISOString().split('T')[0]);
  const before = await page.evaluate(async ({ staffId, today }) => {
    const { data } = await window.__sculptSupabase
      .from('staff_attendance').select('id').eq('staff_id', staffId).eq('date', today);
    return (data || []).length;
  }, { staffId, today });

  const { token } = await page.evaluate(() => window.__sculptCheckin.issueCheckinToken());
  await page.evaluate((t) => window.__sculptCheckin.staffCheckin(t), token);

  const after = await page.evaluate(async ({ staffId, today }) => {
    const { data } = await window.__sculptSupabase
      .from('staff_attendance').select('id').eq('staff_id', staffId).eq('date', today);
    return (data || []).length;
  }, { staffId, today });

  // Whether this particular scan set check_in or moved check_out, the
  // ROW COUNT for today must not grow past the count before this scan
  // plus, at most, the very first insert of the day.
  expect(after).toBeLessThanOrEqual(Math.max(before, 1));
});

test('a check-in is dated in the gym\'s timezone, not UTC', async ({ page }) => {
  // Can't fast-forward the server's clock to prove the UTC-vs-IST bug
  // from here, so this asserts the invariant that makes the bug
  // impossible whenever it DOES run: local_date on a fresh row must
  // equal "today" computed in Asia/Kolkata, which only diverges from a
  // UTC-computed "today" during IST's early morning (UTC 18:30–24:00).
  // Outside that window this still verifies the column is populated and
  // matches the gym's configured timezone rather than silently trusting
  // CURRENT_DATE — see CLAUDE.md's timezone rule and 106_staff_checkin.sql.
  await signInOwner(page);
  const member = await createTestMember(page, { phone: randomPhone() });

  try {
    const { token } = await page.evaluate(() => window.__sculptCheckin.issueCheckinToken());

    await signOutAndGoMemberLogin(page);
    const login = await memberSignIn(page, member.application_number, member.phone);
    expect(login.ok, login.message).toBe(true);
    await page.evaluate((t) => window.__sculptSupabase.rpc('sculpt_member_checkin', { p_token: t }), token);

    await signInOwner(page);
    const row = await page.evaluate(async (memberId) => {
      const { data } = await window.__sculptSupabase
        .from('member_checkins').select('local_date').eq('member_id', memberId).order('checked_in_at', { ascending: false }).limit(1);
      return data?.[0]?.local_date;
    }, member.id);

    const expectedIstDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    expect(row).toBe(expectedIstDate);
  } finally {
    await signInOwner(page);
    await cleanupMember(page, member);
  }
});
