// tests/landing.spec.js
//
// The landing page is the client's public shopfront. These tests check the
// things most likely to break silently: that it renders at all after a
// rewrite, and that it does not overflow horizontally on a phone — which is
// how most of this gym's prospects will see it.

import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const vp of VIEWPORTS) {
  test(`landing renders with no horizontal overflow at ${vp.name}`, async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));

    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.locator('#root')).not.toBeEmpty();

    expect(jsErrors, 'Uncaught JS error on the landing page').toEqual([]);

    // A page wider than its viewport is the most common mobile defect and is
    // invisible in a desktop browser.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, 'The landing page scrolls horizontally').toBeLessThanOrEqual(1);
  });

  test(`landing shows the brand and a burger menu with both logins at ${vp.name}`, async ({ page }) => {
    // Both logins moved into the burger drawer at every width (2026-08) —
    // the top bar is deliberately just the logo + burger now, so "a login
    // CTA" means the burger opens to reveal one, not that one sits bare
    // in the bar. See the reversal comment in src/pages/landing.js.
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/', { waitUntil: 'load' });

    await expect(page.getByText(/D Sculpt Fitness/i).first()).toBeVisible();
    await expect(page.locator('#sc-burger')).toBeVisible();

    await page.locator('#sc-burger').click();
    await expect(page.locator('#sc-nav-member-login')).toBeVisible();
    await expect(page.locator('#sc-nav-staff-login')).toBeVisible();
  });
}

test('landing contact is links, not a form', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();

  // The client explicitly does not want a contact form anywhere.
  expect(
    await page.locator('form').count(),
    'The landing page contains a <form>. Contact must be tel:/wa.me/mailto: links.'
  ).toBe(0);

  // And it must actually offer a way to reach the gym.
  //
  // Two states are legitimate today. Once the client supplies a phone or
  // WhatsApp number the page renders real tel:/wa.me links. Until then it
  // renders visible "to be supplied" chips. What is NOT legitimate is the
  // third state this test used to permit: the page previously fell back to
  // a hardcoded +910000000000 so that a tel: link always existed, which
  // shipped a fake number to real visitors. That fallback is gone, and the
  // assertion below now fails if it ever comes back.
  const contactable =
    (await page.locator('a[href^="tel:"]').count()) +
    (await page.locator('a[href*="wa.me"]').count());
  const pending = await page.locator('.sc-tbd').count();

  expect(
    contactable > 0 || pending > 0,
    'The landing page offers no way to reach the gym and no pending-details marker.'
  ).toBe(true);

  expect(
    await page.locator('a[href*="0000000000"]').count(),
    'A placeholder phone number is being rendered as a real contact link.'
  ).toBe(0);
});

test('the Member Login drawer entry reaches the member login screen, not the staff one', async ({ page }) => {
  // This used to point at the same /login screen as staff/owner — a
  // member typing their application number into an email+password form
  // is exactly the confusion the two-entry drawer exists to prevent.
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();

  await page.locator('#sc-burger').click();
  await page.locator('#sc-nav-member-login').click();
  await expect(page).toHaveURL(/\/member\/login/, { timeout: 10_000 });
  await expect(page.locator('#member-login-form')).toBeVisible();
  await expect(page.locator('#member-appnum')).toBeVisible();
});

test('the Staff & Owner Login drawer entry reaches the staff/owner login screen', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();

  await page.locator('#sc-burger').click();
  await page.locator('#sc-nav-staff-login').click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.getByText(/D Sculpt Fitness/i).first()).toBeVisible();
});

test('the footer Staff & owner login link still works as a secondary path', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.locator('#sc-foot-login').click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  await expect(page.locator('#login-form')).toBeVisible();
});
