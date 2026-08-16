// tests/removed-routes.spec.js
//
// Features removed during the D Sculpt Fitness white-label build must not
// merely be hidden from the nav — their URLs must not crash the app either.
// A stale bookmark or a browser-restored tab will hit these paths.

import { test, expect } from '@playwright/test';

const REMOVED_ROUTES = ['/admin', '/dashboard/broadcast', '/dashboard/contact'];

for (const route of REMOVED_ROUTES) {
  test(`removed route ${route} does not crash the app`, async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));

    await page.goto(route, { waitUntil: 'load' });

    // The app must boot and render something — a login redirect is fine,
    // a blank #root or an uncaught throw is not.
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(jsErrors, `Uncaught JS error on removed route ${route}`).toEqual([]);
  });
}
