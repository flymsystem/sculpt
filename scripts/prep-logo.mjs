// Build the in-app logo assets from sculp-logo.png.
//
// The source is the bare circular mark on transparency. This trims it to
// the mark's own bounding box (so no dead padding eats into the rendered
// size) and writes PNGs at the sizes the UI actually uses, alpha intact.
//
// It deliberately does NOT touch public/icon-*.png — those are the PWA /
// favicon assets and are supposed to keep their opaque plate.
//
//   node scripts/prep-logo.mjs sculp-logo.png public
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [src, outDir] = process.argv.slice(2);
const SIZES = [128, 256, 512];

const browser = await chromium.launch();
const page = await browser.newPage();
const dataUrl = `data:image/png;base64,${fs.readFileSync(src).toString('base64')}`;

const results = await page.evaluate(async ({ dataUrl, sizes }) => {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  // Trim to the opaque bounding box.
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // Keep it square so the disc never renders as an ellipse.
  const side = Math.max(bw, bh);
  const sx = x0 - (side - bw) / 2, sy = y0 - (side - bh) / 2;

  const out = [];
  for (const s of sizes) {
    const o = document.createElement('canvas');
    o.width = s; o.height = s;
    const octx = o.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(img, sx, sy, side, side, 0, 0, s, s);
    out.push({ size: s, url: o.toDataURL('image/png') });
  }
  return { box: [x0, y0, bw, bh], side, source: [W, H], out };
}, { dataUrl, sizes: SIZES });

console.log(`source ${results.source.join('x')} → trimmed box ${results.box.join(',')} → square ${results.side}`);
for (const { size, url } of results.out) {
  const bytes = Buffer.from(url.split(',')[1], 'base64');
  const file = path.join(outDir, `logo-${size}.png`);
  fs.writeFileSync(file, bytes);
  console.log(`logo-${size}.png  ${(bytes.length / 1024).toFixed(0)}KB`);
}
await browser.close();
