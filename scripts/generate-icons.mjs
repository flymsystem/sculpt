// scripts/generate-icons.mjs
//
// Generates the PWA icon set from sculp-logo.png.
//
// Why Playwright and not sharp: this project forbids adding npm dependencies,
// and @playwright/test is already installed with a Chromium binary. Canvas
// downscaling in Chromium is high quality and costs no new packages. This is
// a one-off build-asset script, not part of `npm run build`.
//
// Run:  node scripts/generate-icons.mjs

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'sculp-logo.png';

// At or below 96px the full badge is unreadable — it has three concentric
// chrome rings, an arced SCULPT/FITNESS wordmark and two dumbbells, and all
// of it collapses into grey mush. Verified by rendering it and looking.
//
// So small sizes use `crop`: a centred sub-rectangle of the source (given as
// fractions of the image) holding just the blue figure and swoosh, scaled to
// fill the icon. Large sizes keep the full badge, where the detail reads.
const FIGURE_CROP = { sx: 0.26, sy: 0.28, sw: 0.48, sh: 0.48 };

const SIZES = [
  { size: 48, out: 'public/icon-48.png', crop: FIGURE_CROP },
  { size: 96, out: 'public/icon-96.png', crop: FIGURE_CROP },
  { size: 192, out: 'public/icon-192.png' },
  { size: 512, out: 'public/icon-512.png' },
  { size: 180, out: 'public/apple-touch-icon.png' },
];

// The logo is transparent-background artwork. PWA icons render against
// unpredictable launcher backgrounds, so composite onto the brand black
// rather than shipping transparency.
const BRAND_BLACK = '#050507';

const dataUri =
  'data:image/png;base64,' + readFileSync(SOURCE).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { size, out, crop } of SIZES) {
  const base64 = await page.evaluate(
    async ({ dataUri, size, bg, crop }) => {
      const img = new Image();
      img.src = dataUri;
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (crop) {
        // Draw only the emblem, inset slightly so the swoosh tips do not
        // collide with the icon edge. A wider crop would pull in fragments
        // of the arced wordmark, which read as noise at this scale.
        const pad = Math.round(size * 0.07);
        ctx.drawImage(
          img,
          img.width * crop.sx, img.height * crop.sy,
          img.width * crop.sw, img.height * crop.sh,
          pad, pad, size - pad * 2, size - pad * 2
        );
      } else {
        // The artwork is square; draw it edge to edge with a small inset so
        // the outer chrome ring is not clipped by a circular launcher mask.
        const inset = Math.round(size * 0.04);
        ctx.drawImage(img, inset, inset, size - inset * 2, size - inset * 2);
      }

      return canvas.toDataURL('image/png').split(',')[1];
    },
    { dataUri, size, bg: BRAND_BLACK, crop: crop || null }
  );

  writeFileSync(out, Buffer.from(base64, 'base64'));
  console.log(`OK ${out} (${size}x${size})`);
}

await browser.close();
