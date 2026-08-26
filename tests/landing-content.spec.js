// tests/landing-content.spec.js
//
// Phase E/F coverage: the real contact details, the WhatsApp deep links,
// the popstate same-page-anchor guard, the lazy contact map, and the real
// photograph dimensions. Split out from landing.spec.js (which predates
// this content) rather than folded in, so a future content-only change
// touches one obviously-scoped file.

import { test, expect } from '@playwright/test';

test('the hero and closing "Contact us" CTAs are real WhatsApp deep links, not #contact anchors', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();

  const ctas = page.locator('a.sc-btn', { hasText: 'Contact us' });
  const count = await ctas.count();
  expect(count, 'Expected the hero and closing-band "Contact us" buttons').toBeGreaterThanOrEqual(2);

  for (let i = 0; i < count; i++) {
    const href = await ctas.nth(i).getAttribute('href');
    expect(href, 'Contact us must open WhatsApp directly, not the in-page #contact anchor')
      .toMatch(/^https:\/\/wa\.me\/918867878946\?text=/);
    // Deep link opens in a new tab — clicking it must not tear down the
    // landing page's own document out from under the visitor.
    expect(await ctas.nth(i).getAttribute('target')).toBe('_blank');
  }
});

test('the footer WhatsApp/tel/mailto/Instagram links use the real published numbers', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });

  await expect(page.locator('a[href^="tel:+917892131996"]')).toHaveCount(1);
  await expect(page.locator('a[href^="tel:+918867878946"]')).toHaveCount(1);
  await expect(page.locator('a[href^="mailto:dsculptfitness5@gmail.com"]')).toHaveCount(1);
  // Hero "Contact us", About's "Come and see the floor", the closing-band
  // "Contact us", and the footer's own "WhatsApp us" link.
  await expect(page.locator('a[href*="wa.me/918867878946"]')).toHaveCount(4);
  await expect(page.locator('a[href*="instagram.com/d_sculptfitness"]')).toHaveCount(1);
  // "Open in Maps" in the footer's Visit column, plus the always-visible
  // fallback link overlaid on the (lazy-loaded) map box.
  await expect(page.locator('a[href*="maps.google.com"]')).toHaveCount(2);

  // Every "to be supplied" chip must be gone now that GYM is filled in.
  expect(await page.locator('.sc-tbd').count()).toBe(0);
});

test('the contact map lazy-loads only once the footer scrolls into view', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });

  // Immediately after load, with the footer nowhere near the viewport, the
  // map box must not have created an iframe yet — that would mean it's
  // competing with the hero image for the initial loading budget.
  await expect(page.locator('#sc-map iframe')).toHaveCount(0);

  await page.locator('#sc-map').scrollIntoViewIfNeeded();
  await expect(page.locator('#sc-map iframe')).toHaveCount(1, { timeout: 5000 });

  const src = await page.locator('#sc-map iframe').getAttribute('src');
  expect(src).toContain('maps.google.com');
  expect(src).toContain('output=embed');
});

test('the popstate handler does not tear down the landing page for a same-page anchor click', async ({ page }) => {
  // Regression test for the bug documented in CLAUDE.md / src/app.js: a
  // plain <a href="#why"> click fires `popstate` in Chromium (not just
  // `hashchange`), and router.go() has no "already on this page" guard of
  // its own — without the `page === router.current` early-out in app.js,
  // every nav click tore the whole landing page down and rebuilt it,
  // replaying the intro animation. This test clicks a real nav link and
  // asserts the page was NOT rebuilt: the intro overlay must not
  // reappear, and #root's node identity should be preserved.
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();
  // Let the one-time intro overlay finish and remove itself.
  await page.waitForSelector('#sc-intro', { state: 'detached', timeout: 5000 }).catch(() => {});

  const rootHandle = await page.evaluateHandle(() => document.getElementById('root'));

  await page.locator('#sc-burger').click();
  await page.locator('a.sc-navlink[href="#why"]').click();
  await page.waitForTimeout(300);

  // The intro plate must not have been remounted — a full rebuild always
  // recreates it (see playIntro() in landing.js).
  await expect(page.locator('#sc-intro')).toHaveCount(0);

  // #root itself must be the exact same DOM node as before the click —
  // innerHTML replacement inside it is fine (that's how the plans grid
  // updates), but the router tearing the page down and calling
  // renderLanding() again would still leave #root's *reference* identical
  // (same element, new children) since #root itself is never replaced, so
  // instead assert on the section actually having scrolled to, which only
  // happens via native anchor scrolling, never via a full router.go().
  const sameNode = await page.evaluate(
    (el) => el === document.getElementById('root'),
    rootHandle
  );
  expect(sameNode).toBe(true);

  await expect(page.locator('#why')).toBeInViewport();
});

test('the active nav link tracks the section in view (scrollspy)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();
  // The service worker's controllerchange listener can trigger a reload
  // right after load in some environments; let things settle before
  // driving a scroll so page.evaluate doesn't race a navigation.
  await page.waitForTimeout(300);

  // Scroll all the way to the bottom — #contact (the footer) is the last
  // section on the page, so it is guaranteed to cross the scrollspy's
  // trigger band regardless of exact section heights/viewport size, unlike
  // scrolling to an arbitrary middle section. scrollIntoViewIfNeeded (via
  // the footer's own #contact element) is used instead of a raw
  // window.scrollTo, which was flaky under parallel test load — occasionally
  // firing before the page's full layout height had settled.
  await page.locator('#contact').scrollIntoViewIfNeeded();

  await page.locator('#sc-burger').click();
  // The IntersectionObserver callback + class toggle can lag a busy CI
  // worker by more than a fixed sleep would cover — these assertions poll
  // on their own (default 5s), which is the point of using them instead of
  // another waitForTimeout.
  await expect(page.locator('a.sc-navlink[href="#contact"]')).toHaveClass(/is-active/, { timeout: 5000 });
  await expect(page.locator('a.sc-navlink[href="#contact"]')).toHaveAttribute('aria-current', 'true');
});

test('hero, about and the two real training photos carry width/height to prevent layout shift', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });

  const hero = page.locator('.sc-hero-media img');
  await expect(hero).toHaveAttribute('width', /\d+/);
  await expect(hero).toHaveAttribute('height', /\d+/);

  const about = page.locator('.sc-about-img img');
  await expect(about).toHaveAttribute('width', '1190');
  await expect(about).toHaveAttribute('height', '1322');
});

test('the hero photo is full colour (no duotone class) and interior photos carry the duotone treatment', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });

  // Hero sits in .sc-hero-media, never .sc-duo.
  expect(await page.locator('.sc-hero-media.sc-duo').count()).toBe(0);
  expect(await page.locator('.sc-hero-media img.sc-duo').count()).toBe(0);

  // About and every programme card image are wrapped by a .sc-duo figure,
  // which is what applies the grayscale+blue-blend filter from CSS.
  await expect(page.locator('figure.sc-about-img.sc-duo')).toHaveCount(1);
  const duoProgCount = await page.locator('figure.sc-prog-img.sc-duo').count();
  expect(duoProgCount).toBe(4);
});
