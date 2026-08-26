// tests/member-portal-responsive.spec.js — B1/B2/B3 regressions for the
// member portal shell (src/pages/member/index.js).
//
// window.__sculptRouter (app.js) loads the member module's chunk without a
// live session, and window.__sculptMemberPortal.mount() (member/index.js)
// renders the real shell from a fixture — same test-only-hook convention as
// window._navTo / window.__sculptCheckin. sw.js is blocked because
// index.html's service-worker bootstrap reloads the page on
// 'controllerchange', including the very first SW activation in a fresh
// browser context, which would tear down whatever the test just built.
import { test, expect } from '@playwright/test';

const FIXTURE_MEMBERSHIP = {
  member_id: 'm1',
  gym_id: 'g1',
  member_name: 'Priya Sharma',
  gym_name: 'D Sculpt Fitness',
  gym_logo_url: '/logo-256.png',
  application_number: 'SC-0001-ABC',
  plan_name: 'Gold Plan',
  computed_status: 'Expiring',
  days_remaining: 4,
  balance_due: 1500,
  join_date: '2025-01-01',
  expiry_date: '2026-08-30',
};

async function mountMemberPortal(page, width) {
  await page.route('**/sw.js', (route) => route.abort());
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__sculptRouter?.go === 'function');
  await page.evaluate(() => window.__sculptRouter.go('member'));
  await page.waitForFunction(() => !!window.__sculptMemberPortal);
  // renderMemberPortal(router) is async — it awaits a real getMyMembership()
  // RPC that fails without a live session before settling on the "could
  // not load your account" screen. window.__sculptMemberPortal exists as
  // soon as the module's top-level code runs, well before that promise
  // resolves, so mount() must wait for that in-flight render to actually
  // settle first, or it races it and gets overwritten right after.
  await page.waitForFunction(() => !!document.getElementById('member-portal-retry'));
  await page.evaluate((membership) => {
    window.__sculptMemberPortal.mount({ go() {} }, membership);
  }, FIXTURE_MEMBERSHIP);
}

const WIDTHS = [360, 390, 414, 768];

for (const width of WIDTHS) {
  test(`member portal has no horizontal overflow at ${width}px (Check In / My Plan / Receipts / Visits)`, async ({ page }) => {
    await mountMemberPortal(page, width);
    const tabs = ['checkin', 'plan', 'receipts', 'visits'];
    for (const tab of tabs) {
      if (tab === 'visits') {
        await page.evaluate(() => window.__sculptMemberPortal.renderVisitsFixture([
          { checked_in_at: '2026-08-20T10:00:00Z', status: 'ok', source: 'qr' },
        ]));
      } else if (tab === 'receipts') {
        await page.evaluate(() => window.__sculptMemberPortal.renderReceiptsFixture(
          [{ plan_name: 'Gold Plan', paid_at: '2026-08-01', amount: 3000 }],
          [{ name: 'Invoice-Aug.pdf', url: '#' }]
        ));
      } else {
        await page.evaluate((t) => window.__sculptMemberPortal.goTab(t), tab);
      }
      const hOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(hOverflow, `${tab} tab overflows horizontally at ${width}px`).toBe(false);
    }
  });
}

test('a long receipts list scrolls inside the content area, not the whole page — the bottom nav stays reachable', async ({ page }) => {
  // Regression test: .mp-content is a flex:1 child of a flex-column shell
  // and used to have no min-height:0, so its own overflow-y:auto never
  // engaged — a long list just grew the whole #page-member column (and
  // <body> with it) taller than the viewport, dragging the bottom tab bar
  // (Check In / My Plan / Receipts / Visits) down below the fold. A member
  // scrolling through their receipts had no way back to another tab
  // without first scrolling all the way to the bottom of the list.
  await mountMemberPortal(page, 390);
  await page.evaluate(() => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      plan_name: 'Gold Plan renewal ' + i,
      paid_at: '2026-01-01',
      amount: 3000 + i,
    }));
    window.__sculptMemberPortal.renderReceiptsFixture(many, []);
  });

  const metrics = await page.evaluate(() => ({
    docTallerThanViewport: document.documentElement.scrollHeight > window.innerHeight + 1,
    contentScrollHeight: document.getElementById('mp-content').scrollHeight,
    contentClientHeight: document.getElementById('mp-content').clientHeight,
  }));

  expect(metrics.docTallerThanViewport, 'the whole page scrolled instead of just #mp-content').toBe(false);
  expect(metrics.contentScrollHeight, 'the list should overflow its own container').toBeGreaterThan(metrics.contentClientHeight);

  // The bottom nav must still be visible without scrolling the page.
  await expect(page.locator('.mp-tabbar')).toBeInViewport();
});

test('no dashboard "Add Member" FAB leaks into the member portal', async ({ page }) => {
  // Regression test for the dashboard's owner/staff FAB (updateFAB() in
  // src/pages/dashboard/index.js) being appended to document.body instead
  // of #root. Router navigation only overwrites #root.innerHTML, so a
  // body-level node survived every page change until dashboard/index.js
  // registered a cleanup with window.__sculptRegisterCleanup — without it,
  // a member viewing the portal (e.g. right after an owner used the same
  // browser) would see the owner-only "Add Member" button floating over
  // their bottom nav.
  await mountMemberPortal(page, 390);
  await expect(page.locator('#sculpt-fab')).toHaveCount(0);
  await expect(page.locator('.fab')).toHaveCount(0);
  await expect(page.locator('#sculpt-fab-menu')).toHaveCount(0);
});
