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

  test(`landing shows the brand and a login CTA at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/', { waitUntil: 'load' });

    await expect(page.getByText(/D Sculpt Fitness/i).first()).toBeVisible();

    const cta = page.getByRole('button', { name: /member login|log ?in|sign ?in/i })
      .or(page.getByRole('link', { name: /member login|log ?in|sign ?in/i }));
    await expect(cta.first()).toBeVisible();
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
  expect(await page.locator('a[href^="tel:"]').count()).toBeGreaterThan(0);
});

test('the login CTA reaches the login page', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();

  await page.getByRole('button', { name: /member login/i }).first().click();
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(page.getByText(/Welcome to D Sculpt Fitness/i)).toBeVisible();
});
