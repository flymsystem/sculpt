// tests/member-scan-debounce.spec.js — regression test for the
// "expired -> success -> expired" flicker described in CLAUDE.md's QR
// scanner rule and re-audited for the member check-in tab.
//
// A real expired-member login isn't available to this suite, so the
// camera and the decoder are faked entirely inside the page (a
// canvas.captureStream() MediaStream stands in for getUserMedia, and a
// fake BarcodeDetector keeps "seeing" the same still-visible code every
// animation frame — exactly the condition that used to double-fire the
// check-in RPC before the scanner was stopped on every terminal outcome,
// not just success). The sculpt_member_checkin RPC itself is mocked via
// page.route so the test can force a DENIED/EXPIRED response and count
// exactly how many times it was called.
//
// window.__sculptRouter (app.js) and window.__sculptMemberPortal.mount()
// (src/pages/member/index.js) are the same test-only hooks used
// elsewhere in this suite (window._navTo, window.__sculptCheckin) to
// reach a lazily-loaded page's chunk on the built preview server without
// a live login.
import { test, expect } from '@playwright/test';

const FIXTURE_MEMBERSHIP = {
  member_name: 'Priya Sharma',
  gym_name: 'D Sculpt Fitness',
  gym_logo_url: '/logo-256.png',
  application_number: 'SC-0001-ABC',
  plan_name: 'Gold Plan',
  computed_status: 'Expired',
  days_remaining: -4,
  balance_due: 0,
  join_date: '2025-01-01',
  expiry_date: '2026-08-22',
};

test('a denied/expired scan fires the check-in RPC exactly once and settles into one stable result', async ({ page }) => {
  let rpcCalls = 0;

  // index.html registers a service worker that reloads the page via
  // 'controllerchange' whenever a new SW takes control — including the
  // very first activation in a brand-new browser context. That's an
  // unrelated PWA-update mechanism this test has no interest in, and its
  // reload(s) tear down whatever DOM/state the test just built. Block the
  // SW script so it's never registered at all.
  await page.route('**/sw.js', (route) => route.abort());

  await page.route('**/rest/v1/rpc/sculpt_member_checkin**', async (route) => {
    rpcCalls++;
    // Artificial delay so any second decode event racing the first
    // request would have plenty of time to fire its own overlapping
    // RPC call before the first one resolves — the exact window the old
    // "only stop on success" bug exploited.
    await new Promise((r) => setTimeout(r, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ status: 'EXPIRED', message: 'This membership has expired.' }]),
    });
  });

  // Fake camera + decoder, installed before any app code runs. A
  // canvas.captureStream() MediaStream is a real MediaStream (so
  // videoEl.srcObject accepts it and video.play() resolves), unlike a
  // plain object, which the browser rejects for srcObject.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      // A canvas that's never drawn to never emits a frame, so the
      // captured stream never reaches readyState HAVE_ENOUGH_DATA and
      // <video>.play() hangs with videoWidth/Height stuck at 0 forever —
      // redraw on an interval so the stream actually produces frames.
      let flip = false;
      setInterval(() => {
        flip = !flip;
        ctx.fillStyle = flip ? '#000' : '#fff';
        ctx.fillRect(0, 0, 64, 64);
      }, 50);
      return canvas.captureStream(10);
    };
    // Same fake code decoded on every single frame — simulates the
    // still-visible QR code sitting in front of the camera for the
    // entire scan session, which is what used to cause repeated
    // onDecode firings once the first request's result was slow.
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect() {
        return [{ rawValue: 'SCULPT1:SCULPT01:' + '0'.repeat(32) }];
      }
    };
  });

  await page.goto('/', { waitUntil: 'load' });
  // index.html's service-worker bootstrap reloads the page once via
  // navigator.serviceWorker's 'controllerchange' event — including on a
  // completely fresh browser context, where the very first SW taking
  // control still fires that event. waitForFunction (unlike evaluate)
  // transparently keeps polling across that reload instead of throwing
  // "execution context was destroyed".
  await page.waitForFunction(() => typeof window.__sculptRouter?.go === 'function');

  // Load the member portal chunk (its render will likely fail — there's
  // no real member session — but window.__sculptMemberPortal is a
  // module-level side effect set on import regardless of that outcome).
  await page.evaluate(() => window.__sculptRouter.go('member'));
  await page.waitForFunction(() => !!window.__sculptMemberPortal);
  // renderMemberPortal(router) is async (it awaits a real getMyMembership()
  // RPC that will fail — no live session — before it settles on the
  // "could not load your account" screen). window.__sculptMemberPortal
  // exists as soon as the module's top-level code runs, well before that
  // promise resolves, so calling mount() immediately raced that pending
  // render: it would overwrite #root right after mount() built the real
  // shell, tearing the camera element out mid-scan. Wait for that
  // in-flight render to actually settle before using the fixture hook.
  await page.waitForFunction(() => !!document.getElementById('member-portal-retry'));

  // Mount the real shell with fixture data instead of a live session.
  await page.evaluate((membership) => {
    window.__sculptMemberPortal.mount({ go() {} }, membership);
  }, FIXTURE_MEMBERSHIP);

  await expect(page.locator('#mp-scan-start')).toBeVisible();
  await page.locator('#mp-scan-start').click();

  // Let the fake decoder's requestAnimationFrame loop run for well
  // longer than the mocked RPC's 250ms delay — many decode events fire
  // in that window if the debounce guard is broken.
  await page.waitForTimeout(900);

  // Exactly one RPC call, no matter how many frames the fake camera
  // "decoded" the same code during or after that call.
  expect(rpcCalls, 'sculpt_member_checkin must fire exactly once per physical scan').toBe(1);

  // Exactly one terminal result on screen — the denied/expired card —
  // and it stays put (no flicker loop re-rendering the stage).
  const confirm = page.locator('.mp-confirm-bad');
  await expect(confirm).toHaveCount(1);
  await expect(confirm).toContainText('This membership has expired.');
  const firstHTML = await page.locator('#mp-checkin-stage').innerHTML();
  await page.waitForTimeout(400);
  const secondHTML = await page.locator('#mp-checkin-stage').innerHTML();
  expect(secondHTML, 'the result stage re-rendered after settling — a flicker loop').toBe(firstHTML);

  // "Try Again" starts a genuinely new scan session, not the old one.
  await expect(page.locator('#mp-scan-again')).toBeVisible();
  await page.locator('#mp-scan-again').click();
  await expect(page.locator('#mp-scan-start')).toBeVisible();
});
