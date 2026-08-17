import { chromium } from '@playwright/test';

const WIDTHS = [1600, 1440, 1280, 1024, 768, 480, 390, 375];
const browser = await chromium.launch();

for (const w of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  // The app boots asynchronously; nothing is measurable until it renders.
  await page.waitForSelector('.sc-nav', { timeout: 15000 });

  // Intro should be present and fade out on its own.
  const introAtStart = await page.locator('#sc-intro').count();
  const introLogoW = introAtStart
    ? await page.locator('#sc-intro img').evaluate(e => Math.round(e.getBoundingClientRect().width))
    : 0;
  await page.waitForSelector('#sc-intro', { state: 'detached', timeout: 6000 });

  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const cta = document.getElementById('sc-nav-login');
    const b = cta?.getBoundingClientRect();
    const logo = document.querySelector('.sc-nav-brand img')?.getBoundingClientRect();
    const burger = document.getElementById('sc-burger')?.getBoundingClientRect();
    const vis = (x) => !!x && x.width > 0 && x.height > 0 &&
      x.right <= doc.clientWidth + 1 && x.left >= -1;
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      navLogo: logo ? Math.round(logo.width) : 0,
      ctaVisible: vis(b),
      ctaW: b ? Math.round(b.width) : 0,
      ctaH: b ? Math.round(b.height) : 0,
      burgerShown: !!burger && burger.width > 0,
      overlap: b && burger && burger.width > 0 ? Math.round(b.right - burger.left) : null,
    };
  });

  const ok = r.overflow === 0 && r.ctaVisible && (r.overlap === null || r.overlap <= 0);
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${String(w).padStart(5)}  overflow=${r.overflow}  navLogo=${r.navLogo}px  ` +
    `login=${r.ctaVisible ? 'visible' : 'HIDDEN'} ${r.ctaW}x${r.ctaH}  burger=${r.burgerShown}  ` +
    `introLogo=${introLogoW}px  gap=${r.overlap}`
  );
  await page.close();
}
await browser.close();
