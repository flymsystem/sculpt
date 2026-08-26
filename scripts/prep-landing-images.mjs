// Resize/re-encode photos into web assets for the landing page.
// Uses the Chromium that ships with Playwright — no native image deps
// (sharp, imagemagick, ...) need to be installed on the machine that runs
// this.
//
// PHASE F (2026-08): source moved from the Figma reference export to real
// gym photography in PHOTOS/. The client supplied 4 photos, fewer than the
// 6 image slots the landing page has (hero, about, train-1..4) — this
// script only emits an output for a slot it has real source material for.
// Slots with no real photo keep whatever is already in public/img/ (the
// original template stock shot); see STATUS-PHASE-EF.md for exactly which
// slots are still stock.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SRC = process.argv[2] || path.join(ROOT, 'PHOTOS');
const OUT = process.argv[3] || path.join(ROOT, 'public', 'img');

// source filename (in PHOTOS/) -> [output name, target width, quality]
//
// Mapping choices (recorded here, not just in STATUS-PHASE-EF.md, since
// this file is the thing that would silently go stale if a future photo
// drop changed the source names):
//   main.png      -> hero      full-colour dumbbell rack + branded mirror
//                     wall, the widest/best-lit shot -> the hero slot the
//                     brief named explicitly.
//   sub photo 1   -> about     member facing the branded wall — reads as
//                     "the D Sculpt culture", which is what the About
//                     section text is selling, more than an empty-room shot
//                     would.
//   sub photo 3   -> train-1 (Strength & Conditioning)  barbell rack, plates
//                     and chalk dominate the foreground.
//   sub photo 2   -> train-4 (Cardio & Conditioning)    treadmills in the
//                     foreground, cardio kit reads clearly at card size.
//   train-2 (Personal Training) and train-3 (Group Classes) have no
//   matching source photo and are deliberately left as the stock image —
//   see the "do NOT invent" instruction this phase shipped under.
const JOBS = [
  ['landing page - main.png',      'hero',    1400, 0.76],
  ['landing page - sub photo 1.png', 'about',   1200, 0.80],
  ['landing page - sub photo 3.png', 'train-1',  900, 0.78],
  ['landing page - sub photo 2.png', 'train-4',  900, 0.78],
];

const mimeOf = b =>
  b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : 'image/jpeg';

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

const results = [];

for (const [srcName, name, width, quality] of JOBS) {
  const file = path.join(SRC, srcName);
  if (!fs.existsSync(file)) { console.error(`MISSING ${srcName}`); continue; }
  const buf = fs.readFileSync(file);
  const dataUrl = `data:${mimeOf(buf)};base64,${buf.toString('base64')}`;

  const out = await page.evaluate(async ({ dataUrl, width, quality }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const w = Math.min(width, img.naturalWidth);
    const h = Math.round((w / img.naturalWidth) * img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return { url: c.toDataURL('image/jpeg', quality), w, h, ow: img.naturalWidth, oh: img.naturalHeight };
  }, { dataUrl, width, quality });

  const bytes = Buffer.from(out.url.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, `${name}.jpg`), bytes);
  results.push({ name, w: out.w, h: out.h });
  console.log(
    `${name}.jpg  ${out.ow}x${out.oh} -> ${out.w}x${out.h}  ` +
    `${(buf.length / 1024).toFixed(0)}KB -> ${(bytes.length / 1024).toFixed(0)}KB`
  );
}

// ── Social share image (og:image), 1200x630 ────────────────────────
// Built from the hero photo (already written above) plus the logo, so it
// stays in sync with whatever the hero currently is instead of being a
// separately-maintained crop that can drift out of date.
const heroPath = path.join(OUT, 'hero.jpg');
const logoPath = path.join(ROOT, 'public', 'logo-512.png');
if (fs.existsSync(heroPath) && fs.existsSync(logoPath)) {
  const heroBuf = fs.readFileSync(heroPath);
  const logoBuf = fs.readFileSync(logoPath);
  const heroUrl = `data:image/jpeg;base64,${heroBuf.toString('base64')}`;
  const logoUrl = `data:image/png;base64,${logoBuf.toString('base64')}`;

  const shareOut = await page.evaluate(async ({ heroUrl, logoUrl }) => {
    const W = 1200, H = 630;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    const hero = new Image();
    hero.src = heroUrl;
    await hero.decode();
    // Cover-crop the hero into the 1200x630 plate, biased right (same
    // object-position the hero band itself uses) so the same framing
    // that reads well on the live page reads well in a link preview.
    const srcAr = hero.naturalWidth / hero.naturalHeight;
    const dstAr = W / H;
    let sw, sh, sx, sy;
    if (srcAr > dstAr) {
      sh = hero.naturalHeight;
      sw = sh * dstAr;
      sx = (hero.naturalWidth - sw) * 0.65;
      sy = 0;
    } else {
      sw = hero.naturalWidth;
      sh = sw / dstAr;
      sx = 0;
      sy = (hero.naturalHeight - sh) * 0.5;
    }
    ctx.drawImage(hero, sx, sy, sw, sh, 0, 0, W, H);

    // Darken for legibility, same idea as the live hero's left-side scrim.
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(5,5,7,0.90)');
    grad.addColorStop(0.42, 'rgba(5,5,7,0.55)');
    grad.addColorStop(1, 'rgba(5,5,7,0.15)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const logo = new Image();
    logo.src = logoUrl;
    await logo.decode();
    const logoSize = 108;
    ctx.drawImage(logo, 64, 64, logoSize, logoSize);

    ctx.fillStyle = '#F2F4F8';
    ctx.font = '700 54px Arial, sans-serif';
    ctx.fillText('D SCULPT FITNESS', 64, 320);
    ctx.fillStyle = '#0A84FF';
    ctx.font = '600 30px Arial, sans-serif';
    ctx.fillText('SCULPT THE BODY. BUILD THE DISCIPLINE.', 64, 368);

    return c.toDataURL('image/jpeg', 0.85);
  }, { heroUrl, logoUrl });

  const shareBytes = Buffer.from(shareOut.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, 'og-share.jpg'), shareBytes);
  console.log(`og-share.jpg  1200x630  ${(shareBytes.length / 1024).toFixed(0)}KB`);
} else {
  console.error('SKIPPED og-share.jpg — hero.jpg or logo-512.png missing');
}

await browser.close();

fs.writeFileSync(
  path.join(OUT, '.dimensions.json'),
  JSON.stringify(Object.fromEntries(results.map(r => [r.name, { w: r.w, h: r.h }])), null, 2)
);
