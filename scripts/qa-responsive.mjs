import { chromium } from '@playwright/test';

const WIDTHS = [1600, 1440, 1280, 1024, 768, 480, 390, 375];
const ROUTES = ['/', '/login'];
const BASE = 'http://localhost:4173';

const browser = await chromium.launch();
let problems = 0;

for (const route of ROUTES) {
  for (const w of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(BASE + route, { waitUntil: 'networkidle' });

    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const offenders = [];
      if (overflow > 0) {
        for (const el of document.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (b.right > doc.clientWidth + 1 && b.width > 0) {
            offenders.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(b.right)}`);
          }
        }
      }
      // tiny/clipped text + logo sizes
      const logos = [...document.querySelectorAll('img[src*="logo"]')]
        .map(i => `${i.getAttribute('src')}@${Math.round(i.getBoundingClientRect().width)}px`);
      return { overflow, offenders: offenders.slice(0, 6), logos };
    });

    const bad = r.overflow > 0 || errors.length;
    if (bad) problems++;
    console.log(
      `${bad ? 'FAIL' : 'ok  '} ${route.padEnd(8)} ${String(w).padStart(5)}  overflow=${r.overflow}  logos=[${r.logos.join(', ')}]`
    );
    if (r.offenders.length) console.log('        offenders:', r.offenders.join(' | '));
    if (errors.length) console.log('        errors:', errors.slice(0, 3).join(' | '));
    await page.close();
  }
}

await browser.close();
console.log(problems ? `\n${problems} viewport(s) with problems` : '\nAll viewports clean');
