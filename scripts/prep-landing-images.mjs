// Resize/re-encode the photos extracted from the .fig into web assets.
// Uses the Chromium that ships with Playwright — no native image deps.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];   // fig/images dir
const OUT = process.argv[3];   // public/img dir

// hash prefix -> [output name, target width, quality]
const JOBS = [
  ['e3697832', 'hero',    1200, 0.82],  // dark athlete, weight plate — full colour hero
  // About runs large, so it uses the one interior with no legible wall
  // text. 45fcdec2 carries another gym's slogan across the back wall —
  // fine at card size, not at 1200px.
  ['3620840c', 'about',   1200, 0.80],
  ['4fd33d8c', 'train-1',  760, 0.78],
  ['45fcdec2', 'train-2',  760, 0.78],
  ['db0a38bb', 'train-3',  760, 0.78],
  ['bbe1554f', 'train-4',  760, 0.78],
];

const mimeOf = b =>
  b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : 'image/jpeg';

fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(SRC);

const browser = await chromium.launch();
const page = await browser.newPage();

for (const [hash, name, width, quality] of JOBS) {
  const file = files.find(f => f.startsWith(hash));
  if (!file) { console.error(`MISSING ${hash}`); continue; }
  const buf = fs.readFileSync(path.join(SRC, file));
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
  console.log(
    `${name}.jpg  ${out.ow}x${out.oh} -> ${out.w}x${out.h}  ` +
    `${(buf.length / 1024).toFixed(0)}KB -> ${(bytes.length / 1024).toFixed(0)}KB`
  );
}

await browser.close();
