// tests/rebrand.spec.js
//
// This is a white-label build. Two things must be true in the BROWSER, not
// just in the source: no Flym branding is visible, and the Razorpay SDK —
// which existed only to sell broadcast credits — is never fetched.
//
// Source greps are run separately by the developer; these tests catch the
// case where a string survives into the built bundle.

import { test, expect } from '@playwright/test';

const PUBLIC_PAGES = ['/', '/login'];

for (const path of PUBLIC_PAGES) {
  test(`no Razorpay SDK is requested on ${path}`, async ({ page }) => {
    const razorpayRequests = [];
    page.on('request', (req) => {
      if (req.url().toLowerCase().includes('razorpay')) {
        razorpayRequests.push(req.url());
      }
    });

    await page.goto(path, { waitUntil: 'load' });
    await expect(page.locator('#root')).not.toBeEmpty();

    expect(
      razorpayRequests,
      'The Razorpay checkout SDK was requested. It only ever served the ' +
      'broadcast feature, which has been removed.'
    ).toEqual([]);
  });

  test(`no visible Flym branding on ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    await expect(page.locator('#root')).not.toBeEmpty();

    const bodyText = await page.locator('body').innerText();
    expect(
      bodyText.toLowerCase(),
      'Flym branding is visible on the rendered page.'
    ).not.toContain('flym');

    const title = await page.title();
    expect(title.toLowerCase()).not.toContain('flym');
  });
}
