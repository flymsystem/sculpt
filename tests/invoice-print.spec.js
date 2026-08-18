// tests/invoice-print.spec.js
//
// Guards the invoice sheet against the bug where the printed PDF looked
// nothing like the preview it was generated from.
//
// The preview is an iframe (components/print-preview.js) and printing it calls
// iframe.contentWindow.print(). Chrome resolves the page box for a subframe
// against the TOP document, not the frame's own @page — and the print dialog's
// "Margins: None" overrides CSS margins anyway. So the invoice can be handed a
// zero-margin page box at any time.
//
// It used to answer that by stretching: `@media print` set `.page` to
// width:100%;padding:0 and left the margins to @page. On a zero-margin A4 the
// sheet grew from 660px to the full 794px of paper and printed edge to edge —
// "INVOICE", the invoice number and the Amount column clipped off the right,
// the logo off the left. The on-screen preview looked perfect the whole time,
// which is why nothing caught it.
//
// These tests emulate print media at the full width of bare paper — A4 and
// Letter, no margins — and assert the sheet stays 660px wide and that nothing
// inside it crosses the paper edge. No server and no login needed.

import { test, expect } from '@playwright/test';
import { S } from '../src/pages/dashboard/state.js';
import { buildInvoiceDocument } from '../src/pages/dashboard/invoice-template.js';

const SHEET_WIDTH = 660;

// Bare paper at 96dpi, i.e. the worst case: a page box with zero margins.
const PAPERS = [
  { name: 'A4 portrait, no margins', width: 794, height: 1123 },
  { name: 'US Letter, no margins', width: 816, height: 1056 },
];

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

// The fixture set the sheet is verified against: the plain one-plan receipt the
// bug was reported on, a tax invoice, and a deliberately over-long one that has
// to spill onto a second page.
const FIXTURES = {
  'plain receipt': [MEMBER, {}],
  'GST tax invoice': [MEMBER, GST],
  'GST + add-ons, part paid': [{ ...MEMBER, member_addons: addons(3), balance_due: 3000 }, GST],
  'over-long, breaks to page 2': [
    { ...MEMBER, full_name: 'Bhuvaneshwari Ramachandran Venkataraman', member_addons: addons(7), balance_due: 5000 },
    GST,
  ],
};

function invoiceHtml(member, gym) {
  S.gym = { ...GYM, ...gym };
  S.plans = [{ id: 1, name: 'YEARLY', price: 8000 }];
  return buildInvoiceDocument(member, S.gym.name, 'INV-20260818-T3G1');
}

for (const [label, [member, gym]] of Object.entries(FIXTURES)) {
  for (const paper of PAPERS) {
    test(`invoice (${label}) prints inside ${paper.name}`, async ({ page }) => {
      await page.setViewportSize({ width: paper.width, height: paper.height });
      await page.setContent(invoiceHtml(member, gym));
      await page.emulateMedia({ media: 'print' });

      const m = await page.evaluate(() => {
        const sheet = document.querySelector('.page');
        const r = sheet.getBoundingClientRect();
        let left = r.left;
        let right = r.right;
        for (const el of sheet.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (!b.width && !b.height) continue;   // collapsed spacers
          left = Math.min(left, b.left);
          right = Math.max(right, b.right);
        }
        return { sheet: Math.round(r.width), left: Math.round(left), right: Math.round(right) };
      });

      expect(
        m.sheet,
        'The print sheet must stay at the previewed width. A width:100% here ' +
        'reflows the invoice into a shape nobody has ever looked at.'
      ).toBe(SHEET_WIDTH);

      expect(m.left, 'Invoice content ran off the left edge of the paper').toBeGreaterThanOrEqual(0);
      expect(m.right, 'Invoice content ran off the right edge of the paper').toBeLessThanOrEqual(paper.width);
    });
  }
}

test('the print rules never hand the sheet width over to the paper', async () => {
  const css = invoiceHtml(MEMBER, {});
  const printBlock = css.slice(css.indexOf('@media print'), css.indexOf('</style>'));

  expect(printBlock, 'expected an @media print block in the invoice stylesheet').toContain('.page');
  expect(
    printBlock.replace(/\s/g, ''),
    'width:100% is back in the print rules — that is the exact bug this file guards.'
  ).not.toContain('width:100%');
});
