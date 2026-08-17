// Responsive QA sweep of every dashboard section, logged in.
// Usage: SCULPT_TEST_EMAIL=... SCULPT_TEST_PASSWORD=... node scripts/qa-dashboard.mjs
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4173';
const WIDTHS = [1600, 1440, 1280, 1024, 768, 480, 390, 375];
const SECTIONS = [
  'overview', 'members', 'enquiries', 'alerts', 'staff',
  'finance', 'expenses', 'plans', 'gymconfig', 'backup', 'analytics',
];

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('Set SCULPT_TEST_EMAIL and SCULPT_TEST_PASSWORD.');
  process.exit(2);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Sign in once and reuse the session for every viewport.
const login = await ctx.newPage();
await login.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await login.fill('input[type="email"]', EMAIL);
await login.fill('input[type="password"]', PASSWORD);
await login.click('button[type="submit"]');
await login.waitForURL(/\/dashboard/, { timeout: 30000 });
await login.waitForSelector('.sidebar, aside', { timeout: 20000 });
await login.close();

let problems = 0;
for (const w of WIDTHS) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: 900 });
  const rows = [];
  for (const s of SECTIONS) {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${BASE}/dashboard/${s}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const offenders = [];
      if (overflow > 0) {
        for (const el of document.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (b.right > doc.clientWidth + 1 && b.width > 0 && b.height > 0) {
            const cs = getComputedStyle(el);
            // Report only the element that actually establishes the overflow,
            // not every descendant carried along by it.
            if (cs.overflowX === 'visible') {
              offenders.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().split(/\s+/)[0]}=${Math.round(b.right)}`);
            }
          }
        }
      }
      return { overflow, offenders: [...new Set(offenders)].slice(0, 4) };
    });

    const bad = r.overflow > 0 || errors.length;
    if (bad) {
      problems++;
      rows.push(`   FAIL ${s}: overflow=${r.overflow} ${r.offenders.join(' | ')} ${errors.slice(0, 2).join(' | ')}`);
    }
  }
  console.log(rows.length ? `${w}:\n${rows.join('\n')}` : `ok  ${w}  all ${SECTIONS.length} sections clean`);
  await page.close();
}

await browser.close();
console.log(problems ? `\n${problems} section/viewport problems` : '\nDashboard clean at every width');
