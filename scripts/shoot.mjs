// Screenshot helper for visual QA.
//   node scripts/shoot.mjs <url> <outDir> [w x h[,wxh...]] [--full]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [url, outDir, sizesArg = '1440x900', ...rest] = process.argv.slice(2);
const full = rest.includes('--full');
const sizes = sizesArg.split(',').map(s => s.split('x').map(Number));

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  await page.goto(url, { waitUntil: 'networkidle' }).catch(e => errors.push('NAV ' + e.message));
  await page.waitForTimeout(900);
  // Reveal-on-scroll elements start hidden; force them visible for the shot.
  await page.evaluate(() => document.querySelectorAll('.sc-reveal').forEach(e => e.classList.add('is-in')));
  // Lazy images below the fold never decode during a fullPage capture, which
  // reads as "the image is broken". Force them eager and wait for decode.
  await page.evaluate(async () => {
    const imgs = [...document.images];
    imgs.forEach(i => { i.loading = 'eager'; if (!i.complete) i.src = i.src; });
    await Promise.all(imgs.map(i => i.decode().catch(() => {})));
  });
  await page.waitForTimeout(400);

  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));

  await page.screenshot({ path: `${outDir}/${w}x${h}.png`, fullPage: full });
  console.log(
    `${w}x${h}  scrollW=${overflow.scrollW} clientW=${overflow.clientW}` +
    `${overflow.scrollW > overflow.clientW + 1 ? '  ⚠ HORIZONTAL OVERFLOW' : ''}` +
    (errors.length ? `\n   errors: ${errors.slice(0, 4).join(' | ')}` : '')
  );
  await page.close();
}
await browser.close();
