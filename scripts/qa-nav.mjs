import { chromium } from '@playwright/test';

// Both logins moved into the burger drawer at every width (2026-08) —
// the top bar is now just the logo + burger. This sweep replaces the
// old "login pill stays visible in the bar" check with: burger is
// always there, opening it reveals two visually distinct login
// buttons (member vs staff/owner) that don't overlap, and closing
// still works. See the reversal comment in src/pages/landing.js.
const WIDTHS = [1600, 1440, 1280, 1024, 768, 480, 390, 375];
const browser = await chromium.launch();

for (const w of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sc-nav', { timeout: 15000 });

  const introAtStart = await page.locator('#sc-intro').count();
  const introLogoW = introAtStart
    ? await page.locator('#sc-intro img').evaluate(e => Math.round(e.getBoundingClientRect().width))
    : 0;
  await page.waitForSelector('#sc-intro', { state: 'detached', timeout: 6000 });

  const before = await page.evaluate(() => {
    const doc = document.documentElement;
    const logo = document.querySelector('.sc-nav-brand img')?.getBoundingClientRect();
    const burger = document.getElementById('sc-burger')?.getBoundingClientRect();
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      navLogo: logo ? Math.round(logo.width) : 0,
      burgerShown: !!burger && burger.width > 0 && burger.height > 0,
    };
  });

  await page.locator('#sc-burger').click();
  await page.waitForSelector('#sc-nav-links.is-open', { timeout: 3000 }).catch(() => {});

  const opened = await page.evaluate(() => {
    const doc = document.documentElement;
    const mem = document.getElementById('sc-nav-member-login')?.getBoundingClientRect();
    const staff = document.getElementById('sc-nav-staff-login')?.getBoundingClientRect();
    const vis = (x) => !!x && x.width > 0 && x.height > 0 && x.right <= doc.clientWidth + 1 && x.left >= -1;
    // "clearly separated": the two buttons' vertical spans must not
    // overlap, and they must not be identically styled (checked via
    // font-weight, since member login is bold and staff login isn't).
    const noOverlap = mem && staff ? (mem.bottom <= staff.top || staff.bottom <= mem.top) : false;
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      memberVisible: vis(mem),
      staffVisible: vis(staff),
      noOverlap,
    };
  });

  const ok = before.overflow === 0 && before.burgerShown &&
    opened.overflow === 0 && opened.memberVisible && opened.staffVisible && opened.noOverlap;

  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${String(w).padStart(5)}  overflow=${before.overflow}  navLogo=${before.navLogo}px  ` +
    `burger=${before.burgerShown}  memberLogin=${opened.memberVisible}  staffLogin=${opened.staffVisible}  ` +
    `separated=${opened.noOverlap}  introLogo=${introLogoW}px`
  );
  await page.close();
}
await browser.close();
