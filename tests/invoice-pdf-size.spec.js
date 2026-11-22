// tests/invoice-pdf-size.spec.js
//
// Guards the size of the invoice PDF that "Send on WhatsApp" uploads to the
// `invoices` storage bucket.
//
// The export used to rasterise the sheet as a lossless PNG at html2canvas
// scale 3 — a ~1980×2800 bitmap per page, which jsPDF embeds close to raw.
// Every PDF came out at ~15 MB. Each WhatsApp tap uploads a fresh one
// (genInvoiceNo() is random, so nothing is ever overwritten), and 81 of
// them took the project to 1.2 GB — 126% of the free plan's 1 GB storage —
// and into Supabase's grace period, with requests to be refused (HTTP 402)
// after 24 Nov 2026. A one-page receipt has no business being bigger than
// a few hundred kB.
//
// This renders the real invoice markup with the real PDF_OPTIONS from
// src/lib/invoice-pdf.js, the same way generateInvoicePdfBlob() does, and
// asserts on the byte size. No server and no login needed. The PDF path has
// to run in a browser — html2canvas behaves differently from the browser's
// own print engine — so html2pdf's standalone bundle is loaded into the page
// rather than the app's lazy chunk.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { S } from '../src/pages/dashboard/state.js';
import { buildInvoiceDocument } from '../src/pages/dashboard/invoice-template.js';
import { PDF_OPTIONS } from '../src/lib/invoice-pdf.js';

const MAX_BYTES = 1024 * 1024; // 1 MB — generous; a healthy one-page receipt is far below

const GYM = { name: 'D Sculpt Fitness', email: 'sculptfit@gmail.com', logo_url: '' };
const GST = {
  gst_enabled: true, gst_percentage: 18, gstin: '29ABCDE1234F1Z5',
  address: '12 MG Road, Indiranagar', city: 'Bengaluru', phone: '+91 90000 00000',
};
const MEMBER = {
  id: 1, full_name: 'Steven', phone: '+919945791450',
  plan_id: 1, plan_name: 'YEARLY', join_date: '2026-08-18', plan_duration_months: 12,
  discount_amount: 1000, balance_due: 0, payment_mode: 'Online',
};
const addons = (n) => JSON.stringify(
  [['Personal Training', 12000], ['Locker', 1500], ['Diet Plan', 2500], ['Sauna Access', 3000],
    ['Group Classes', 2000], ['Physio Session', 4500], ['Supplement Pack', 3500]]
    .slice(0, n).map(([name, price]) => ({ name, price }))
);

const FIXTURES = {
  'plain receipt': [MEMBER, {}],
  'GST tax invoice': [MEMBER, GST],
  'over-long, breaks to page 2': [
    { ...MEMBER, full_name: 'Bhuvaneshwari Ramachandran Venkataraman', member_addons: addons(7), balance_due: 5000 },
    GST,
  ],
};

for (const [label, [member, gym]] of Object.entries(FIXTURES)) {
  test(`invoice PDF (${label}) stays under 1 MB`, async ({ page }) => {
    S.gym = { ...GYM, ...gym };
    S.plans = [{ id: 1, name: 'YEARLY', price: 8000 }];
    const html = buildInvoiceDocument(member, S.gym.name, 'INV-20260818-T3G1');

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: 'node_modules/html2pdf.js/dist/html2pdf.bundle.min.js' });

    const { size, pages, b64 } = await page.evaluate(async ({ html, opts }) => {
      // Same container setup as generateInvoicePdfBlob().
      const container = document.createElement('div');
      Object.assign(container.style, {
        position: 'fixed', left: '0', top: '0', width: '660px', background: '#fff',
        zIndex: '-9999', opacity: '0', pointerEvents: 'none',
      });
      container.innerHTML = html;
      document.body.appendChild(container);
      const target = container.querySelector('.page') || container;
      target.style.zoom = '1';
      const blob = await window.html2pdf().set(opts).from(target).outputPdf('blob');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const text = new TextDecoder('latin1').decode(bytes);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { size: blob.size, pages: (text.match(/\/Type\s*\/Page[^s]/g) || []).length, b64: btoa(bin) };
    }, { html, opts: PDF_OPTIONS });

    // Opt-in: keep the PDFs for eyeballing render quality after a settings change.
    if (process.env.INVOICE_PDF_OUT) {
      mkdirSync(process.env.INVOICE_PDF_OUT, { recursive: true });
      writeFileSync(`${process.env.INVOICE_PDF_OUT}/${label.replace(/\W+/g, '-')}.pdf`, Buffer.from(b64, 'base64'));
    }
    console.log(`[invoice-pdf-size] ${label}: ${(size / 1024).toFixed(0)} kB, ${pages} page(s)`);

    expect(pages, 'the PDF should have at least one page').toBeGreaterThan(0);
    expect(
      size,
      `Invoice PDF is ${(size / 1024 / 1024).toFixed(1)} MB. Every WhatsApp send uploads one of ` +
      'these to the invoices bucket — at ~15 MB each that filled the 1 GB free-plan storage.'
    ).toBeLessThan(MAX_BYTES);
  });
}
