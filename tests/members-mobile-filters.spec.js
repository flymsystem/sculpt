// tests/members-mobile-filters.spec.js — All Members' mobile filter row.
//
// Root cause: components.css (loaded first, always — imported from app.js)
// already set a correct 2-up mobile grid for .members-filters at
// max-width:768px. dashboard.css (loaded second, lazily, only once the
// dashboard route mounts) redeclared the same class at the same
// breakpoint with display:flex;flex-direction:column — same specificity,
// later in the cascade, so it silently won and threw away the grid. With
// the container switched to column, every child's `flex:1 1 130px`
// (written for a row, where flex-basis means width) got reinterpreted
// along the now-vertical main axis: flex-basis:130px became a 130px-tall
// row, flex-grow:1 stretched it further to fill whatever vertical space
// the column had — that's what produced ~145px-tall filter boxes with
// the members table several scrolls down.
//
// Fix: removed dashboard.css's conflicting rule; added a "More filters"
// toggle (closed by default) collapsing join-date + Added-By behind a
// button, since search + status/plan alone is enough for the common
// case and keeps the filter block to two rows instead of three.
//
// Needs SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD (owner login) and
// --workers=1, same as the rest of the credentialed suite.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Needs SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD (owner login)');

async function openMembers(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await page.waitForFunction(() => typeof window._navTo === 'function');
  await page.waitForFunction(() => !!document.querySelector('#gym-content .content-inner'));
  await page.evaluate(() => window._navTo('members'));
  await page.waitForFunction(() => !!window.__sculptMembers);
  await page.waitForSelector('#members-table-wrap', { state: 'visible' });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test(`filter controls are ~40-44px tall, search+status/plan fit under 120px, table is reachable without scrolling past a wall of filters`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openMembers(page);

      const m = await page.evaluate(() => {
        const filters = document.querySelector('.members-filters');
        const search = document.getElementById('msearch');
        const status = document.getElementById('sf-status');
        const plan = document.getElementById('sf-plan');
        const toggle = document.getElementById('mf-more-toggle');
        const more = document.getElementById('mf-more');
        const tableWrap = document.getElementById('members-table-wrap');

        const h = (el) => Math.round(el.getBoundingClientRect().height);
        const filtersRect = filters.getBoundingClientRect();
        // .mf-more starts closed — its own bounding box is meaningless
        // (display:none), so "closed-state total height" is what matters
        // for the "table reachable in one screen" requirement.
        const moreIsOpen = more.classList.contains('is-open');

        return {
          searchH: h(search),
          statusH: h(status),
          planH: h(plan),
          toggleH: h(toggle),
          moreIsOpenByDefault: moreIsOpen,
          moreDisplay: getComputedStyle(more).display,
          filtersTotalHeight: Math.round(filtersRect.height),
          tableWrapTop: Math.round(tableWrap.getBoundingClientRect().top),
          bodyScrollWidth: document.body.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });

      console.log(`[${viewport.width}px] search=${m.searchH}px status=${m.statusH}px plan=${m.planH}px toggle=${m.toggleH}px filtersBlock=${m.filtersTotalHeight}px tableWrapTop=${m.tableWrapTop}px moreOpenByDefault=${m.moreIsOpenByDefault}`);

      for (const [label, height] of [['search', m.searchH], ['status', m.statusH], ['plan', m.planH], ['toggle', m.toggleH]]) {
        expect(height, `${label} control should be ~40-44px tall (tap target), was ${height}px`).toBeGreaterThanOrEqual(36);
        expect(height, `${label} control should be ~40-44px tall, not the old ~145px stretched box`).toBeLessThanOrEqual(46);
      }

      expect(m.moreIsOpenByDefault, '"More filters" (join date / Added By) must be collapsed by default').toBe(false);
      expect(m.moreDisplay, 'a closed .mf-more must not participate in layout').toBe('none');

      expect(m.filtersTotalHeight, `whole filter block should be under ~120px with More filters closed, was ${m.filtersTotalHeight}px`).toBeLessThan(120);

      // "the members table must be visible without scrolling past one
      // screen of filters" — the table wrap's top edge (which still
      // needs the topbar, page header and filter block above it) should
      // land within the viewport height, not several scrolls down.
      expect(m.tableWrapTop, `#members-table-wrap starts at ${m.tableWrapTop}px — should be well under one viewport height (${viewport.height}px)`).toBeLessThan(viewport.height);

      expect(m.bodyScrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(m.viewportWidth + 1); // +1 for sub-pixel rounding
    });

    test('the "More filters" toggle opens join date + Added By and they render at the same control height', async ({ page }) => {
      await page.setViewportSize(viewport);
      await openMembers(page);

      await page.locator('#mf-more-toggle').click();

      const m = await page.evaluate(() => {
        const more = document.getElementById('mf-more');
        const joindate = document.getElementById('sf-joindate');
        const addedby = document.getElementById('sf-addedby');
        const h = (el) => Math.round(el.getBoundingClientRect().height);
        return {
          isOpen: more.classList.contains('is-open'),
          display: getComputedStyle(more).display,
          joindateH: h(joindate),
          addedbyH: h(addedby),
          toggleAriaExpanded: document.getElementById('mf-more-toggle').getAttribute('aria-expanded'),
        };
      });

      expect(m.isOpen).toBe(true);
      expect(m.display).toBe('contents');
      expect(m.toggleAriaExpanded).toBe('true');
      expect(m.joindateH, 'join date control should be ~40-44px tall once opened').toBeGreaterThanOrEqual(36);
      expect(m.joindateH).toBeLessThanOrEqual(46);
      expect(m.addedbyH, 'Added By control should be ~40-44px tall once opened').toBeGreaterThanOrEqual(36);
      expect(m.addedbyH).toBeLessThanOrEqual(46);
    });
  });
}

test('desktop (>=1024px) filter layout is unchanged by the mobile collapse feature', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openMembers(page);

  const m = await page.evaluate(() => {
    const filters = document.querySelector('.members-filters');
    const toggle = document.getElementById('mf-more-toggle');
    const more = document.getElementById('mf-more');
    const joindate = document.getElementById('sf-joindate');
    return {
      filtersDisplay: getComputedStyle(filters).display,
      toggleDisplay: getComputedStyle(toggle).display,
      moreDisplay: getComputedStyle(more).display,
      // On desktop .mf-more is display:contents — its children (join
      // date, Added By) must be visible and sitting on the same row as
      // search/status/plan, not hidden behind the (hidden) toggle.
      joindateVisible: joindate.getBoundingClientRect().width > 0,
    };
  });

  expect(m.filtersDisplay, 'desktop keeps the original flex row, not the mobile grid').toBe('flex');
  expect(m.toggleDisplay, 'the More filters toggle must stay hidden on desktop').toBe('none');
  expect(m.moreDisplay, 'display:contents keeps .mf-more invisible to desktop layout').toBe('contents');
  expect(m.joindateVisible, 'join date must be visible on desktop, not hidden behind a mobile-only toggle').toBe(true);
});
