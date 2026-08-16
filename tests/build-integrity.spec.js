// tests/build-integrity.spec.js
//
// These tests need NO login and touch NO data. They run entirely against the
// built static output, so they are safe to run any time — including against a
// build you are about to upload to Cloudflare.
//
// What they exist to catch:
//
// 1. THE BASE-PATH BUG (the important one).
//    If vite.config.js ever goes back to `base: './'`, a hard refresh on a deep
//    route like /dashboard/finance resolves ./assets/main-xxx.js against
//    /dashboard/, requests a file that does not exist, and the Cloudflare
//    catch-all rewrite returns index.html WITH A 200. The browser then parses
//    HTML as JavaScript and the page goes blank — with no 404 anywhere to point
//    at it. This was live for months precisely because nothing errors visibly.
//
//    A human cannot reliably catch this by clicking around, because it only
//    appears on a HARD REFRESH of a DEEP route — normal in-app navigation works
//    fine. That is exactly the kind of thing worth automating.
//
// 2. The ~935 kB PDF engine sneaking into the initial page load.
// 3. Uncaught JS errors on the public pages.
//
// Note on waiting: these use waitUntil:'load' rather than 'networkidle'.
// index.html pulls in Razorpay's SDK and Google Fonts from external CDNs, and
// 'networkidle' would make every test hostage to those third parties being
// fast. 'load' plus Playwright's auto-retrying assertions is both faster and
// far less flaky.

import { test, expect } from '@playwright/test';

// The routes with a / in the path are the ones that trigger the base-path bug.
const DEEP_ROUTES = [
  '/dashboard/finance',
  '/dashboard/members',
  '/dashboard/staff',
  '/dashboard/analytics',
];

for (const route of DEEP_ROUTES) {
  test(`hard refresh of ${route} loads real JS, not HTML`, async ({ page }) => {
    const htmlServedAsJs = [];
    page.on('response', (res) => {
      if (!res.url().endsWith('.js')) return;
      const contentType = res.headers()['content-type'] || '';
      if (contentType.includes('text/html')) {
        htmlServedAsJs.push(`${res.url()}  →  served as ${contentType}`);
      }
    });

    await page.goto(route, { waitUntil: 'load' });

    expect(
      htmlServedAsJs,
      'A <script> tag resolved to HTML instead of JavaScript. This is the ' +
      'vite base-path bug — check that vite.config.js still has base: "/" ' +
      'and NOT base: "./".'
    ).toEqual([]);
  });
}

test('login page boots and renders', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  await page.goto('/login', { waitUntil: 'load' });

  // #root is the app shell's mount point (see index.html). If the bundle
  // failed to execute, this stays empty. not.toBeEmpty() auto-retries, so
  // this doubles as the "wait for the app to boot" step.
  await expect(page.locator('#root')).not.toBeEmpty();
  expect(jsErrors, 'Uncaught JS error on the login page').toEqual([]);
});

test('landing page boots and renders', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  await page.goto('/', { waitUntil: 'load' });

  await expect(page.locator('#root')).not.toBeEmpty();
  expect(jsErrors, 'Uncaught JS error on the landing page').toEqual([]);
});

test('the PDF engine is NOT downloaded on a normal page load', async ({ page }) => {
  // vendor-pdf is ~935 kB. It must only download when someone actually
  // generates an invoice PDF. If a future change statically imports
  // html2pdf.js instead of dynamically importing it, every visitor pays for
  // it on first load — on the cheap Android phones this product targets.
  const loadedChunks = [];
  page.on('response', (res) => {
    if (res.url().endsWith('.js')) loadedChunks.push(res.url());
  });

  await page.goto('/login', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();

  const pdfChunk = loadedChunks.find((u) => u.includes('vendor-pdf'));
  expect(
    pdfChunk,
    'vendor-pdf loaded on a page that generates no PDF — something that ' +
    'should be a dynamic import() became a static import.'
  ).toBeUndefined();
});
