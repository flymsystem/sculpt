// src/pages/dashboard/invoice-template.js
// ─────────────────────────────────────────────────────────────────
// The D Sculpt Fitness membership invoice / receipt document.
//
// One HTML string, three destinations:
//   1. the in-app print preview (iframe, src/components/print-preview.js)
//   2. the browser print dialog from that iframe
//   3. the PDF blob that gets uploaded and WhatsApp'd
//      (src/lib/invoice-pdf.js renders `.page` at 660px into A4)
//
// Two constraints that look arbitrary but are not:
//
//   `.page` is 660px wide and invoice-pdf.js must size its off-screen
//   container to the same number — html2pdf maps that width onto A4
//   portrait, so the two have to agree or the export rescales. At 660px
//   the A4 ratio puts the page break at 933px, and the sheet is laid out
//   to land comfortably inside that and stay one page.
//
//   Every CSS rule is scoped to `body.inv-doc` or `.page`.  The PDF path
//   injects this markup with innerHTML into the *live app document*, and
//   innerHTML keeps `<style>` blocks: a bare `body { }` rule here would
//   repaint the dashboard for as long as the render takes. `.inv-doc` is
//   a class the app's own body never has.
//
// Print behaviour: the sheet stays 660px wide and centres itself on the
// paper in `@media print` too — it must never be widened to `width:100%`
// and must never rely on `@page` for its margins. See the long note above
// the print rules at the bottom of the stylesheet for what that cost us.
//
// Calculations are unchanged from the original invoice — GST, discount,
// balance and invoice numbering all still come from the same fields.
// ─────────────────────────────────────────────────────────────────
import { S } from './state.js';
import { expiryDate, escHtml, genInvoiceNo, parseMemberAddons } from './helpers.js';

// Print-safe brand palette. The dashboard's blue (#0A84FF) is tuned for a
// near-black UI; on white paper it washes out, so the invoice uses the
// light-theme tone of the same brand blue (--brand in [data-theme="light"]),
// which holds up in ink and clears 4.5:1 on white.
const BLUE       = '#0A63C4';
const BLUE_DEEP  = '#084F9E';
const BLUE_TINT  = '#EEF4FC';
const BLUE_LINE  = '#CFE0F5';
const BLUE_ONINK = '#7FB6F2';   // blue label on the near-black card
const INK        = '#0B0D11';
const INK_2      = '#3F4753';
const MUTED      = '#79818E';
const LINE       = '#E6E9EE';
const GREEN      = '#0B7D4E';
const GREEN_TINT = '#E9F6EF';
const AMBER      = '#A76A00';
const AMBER_TINT = '#FDF3E2';
const RED        = '#C42B2B';
const RED_TINT   = '#FBECEC';

const DEFAULT_TERMS = [
  'This receipt is issued on payment and is non-refundable.',
  'Please retain this receipt for any future reference or dispute.',
  'Membership is subject to the gym’s rules and conditions displayed on the premises.',
  'No cash refunds will be provided for unused membership days.',
  'The gym is not responsible for personal belongings left on the premises.',
];

const fmtLong = (d) =>
  d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

/**
 * Builds the full invoice document for a member.
 * @param {object} m         member row
 * @param {string} gymName   display name for the gym
 * @param {string} [invoiceNo] reuse an already-generated number, or mint one
 */
function buildInvoiceDocument(m, gymName, invoiceNo) {
  const g = S.gym || {};

  // ── Dates ──────────────────────────────────────────────────────
  const exp     = expiryDate(m);
  const expStr  = fmtLong(exp);
  const joinDt  = m.join_date ? new Date(m.join_date) : null;
  const joinStr = fmtLong(joinDt);
  invoiceNo     = invoiceNo || genInvoiceNo();
  const dateStr = fmtLong(new Date());

  // ── Money (unchanged) ──────────────────────────────────────────
  const memberAddons  = parseMemberAddons(m);
  const basePlan      = S.plans.find(p => m.plan_id ? String(p.id) === String(m.plan_id) : p.name === (m.plan_name || m.plan));
  const basePlanPrice = basePlan ? parseFloat(basePlan.price) : (parseFloat(m.plan_price) || 0);
  const addonTotal    = memberAddons.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  const totalPrice    = basePlanPrice + addonTotal;

  const discount   = parseFloat(m.discount_amount) || 0;
  const netTotal   = Math.max(0, totalPrice - discount);
  const balanceDue = parseFloat(m.balance_due) || 0;
  const amountPaid = Math.max(0, netTotal - balanceDue);

  const gstOn   = !!g.gst_enabled;
  const gstPct  = gstOn ? (parseFloat(g.gst_percentage) || 18) : 0;
  const halfPct = gstPct / 2;
  const fmtNum  = (v) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // GST is inclusive: the plan price already contains the tax.
  const computeRow = (rate) => {
    if (gstOn) {
      const taxable = rate / (1 + gstPct / 100);
      return { taxable, gst: rate - taxable, amount: rate };
    }
    return { taxable: rate, gst: 0, amount: rate };
  };

  const taxableAmount = gstOn ? (netTotal / (1 + gstPct / 100)) : netTotal;
  const totalGST      = gstOn ? (netTotal - taxableAmount) : 0;
  const halfGST       = totalGST / 2;

  const payStatus = balanceDue > 0 ? (amountPaid > 0 ? 'PARTIAL' : 'DUE') : 'PAID';
  const statusTone = payStatus === 'PAID'
    ? { fg: GREEN, bg: GREEN_TINT, border: '#BBE0CD' }
    : payStatus === 'PARTIAL'
      ? { fg: AMBER, bg: AMBER_TINT, border: '#F0D9AC' }
      : { fg: RED, bg: RED_TINT, border: '#F0C4C4' };

  // ── Line items ─────────────────────────────────────────────────
  const planDesc      = (m.plan_name || m.plan || 'Membership').toUpperCase();
  const planDateRange = (joinStr && expStr) ? `${joinStr} – ${expStr}` : '';

  const itemRow = (n, title, sub, rate) => {
    const c = computeRow(rate);
    return `<tr>
      <td class="c-num">${n}</td>
      <td class="c-desc"><span class="i-name">${escHtml(title)}</span>${sub ? `<span class="i-sub">${escHtml(sub)}</span>` : ''}</td>
      <td class="c-qty">1</td>
      <td class="c-money">₹${fmtNum(rate)}</td>
      ${gstOn ? `<td class="c-money">₹${fmtNum(c.taxable)}</td><td class="c-money">₹${fmtNum(c.gst)}</td>` : ''}
      <td class="c-money c-total">₹${fmtNum(c.amount)}</td>
    </tr>`;
  };

  let rowNum = 1;
  let itemRowsHTML = itemRow(rowNum, planDesc, planDateRange, basePlanPrice);
  memberAddons.forEach(a => {
    rowNum++;
    itemRowsHTML += itemRow(rowNum, a.name, '', parseFloat(a.price) || 0);
  });

  // ── Terms, split into two balanced columns ─────────────────────
  // Split in JS rather than with CSS columns: html2canvas does not lay out
  // multi-column text, so the PDF would not match the preview.
  const terms = g.invoice_terms
    ? g.invoice_terms.split('\n').map(l => l.trim()).filter(Boolean)
    : DEFAULT_TERMS;
  const half = Math.ceil(terms.length / 2);
  const termCol = (list) => `<ul class="tc">${list.map(t => `<li>${escHtml(t)}</li>`).join('')}</ul>`;

  // ── Gym contact details — only what is actually configured ─────
  const contactBits = [g.phone, g.phone2, g.email].filter(Boolean).map(escHtml);
  const addressLine = [g.address, g.city].filter(Boolean).map(escHtml).join(', ');

  // ── Membership detail rows — only fields that actually exist ───
  const detailRows = [
    ['Plan', escHtml(m.plan_name || m.plan || '—')],
    joinStr ? ['Start Date', joinStr] : null,
    expStr  ? ['Valid Till', expStr]  : null,
  ].filter(Boolean)
   .map(([k, v]) => `<div class="p-row"><span class="p-k">${k}</span><span class="p-v">${v}</span></div>`)
   .join('');

  const amountLabel = payStatus === 'PAID' ? 'Amount Paid' : 'Total Payable';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${invoiceNo} — ${escHtml(m.full_name || m.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">
<style>
  /* Every selector is scoped — see the note at the top of this file. */
  body.inv-doc{
    margin:0;padding:22px 16px;background:#EDEFF3;
    font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    -webkit-font-smoothing:antialiased;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;
  }
  body.inv-doc ::selection{background:${BLUE_TINT};color:${INK};}

  .page{
    box-sizing:border-box;width:660px;max-width:660px;margin:0 auto;
    min-height:896px;                 /* 660 : 933 is A4 portrait */
    padding:32px 40px 24px;background:#fff;color:${INK};
    font-size:12.5px;line-height:1.5;
    display:flex;flex-direction:column;
    box-shadow:0 1px 2px rgba(5,5,7,0.06),0 18px 44px rgba(5,5,7,0.10);
    -webkit-print-color-adjust:exact;print-color-adjust:exact;
  }
  .page *{box-sizing:border-box;}
  .page p,.page ul,.page li,.page h1,.page h2,.page table{margin:0;padding:0;}
  .page ul{list-style:none;}
  /* Money never reflows column width mid-document. */
  .page .num{font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1;}

  /* ── Brand rule ── */
  .page .mcard,.page .box,.page .sum-row,.page .terms,.page .foot,.page tr{
    break-inside:avoid;page-break-inside:avoid;
  }
  .page .brandbar{height:5px;background:${BLUE};margin:-32px -40px 22px;}

  /* ── Header ── */
  .page .head{display:flex;justify-content:space-between;align-items:flex-start;gap:28px;}
  .page .head-l{flex:1;min-width:0;}
  .page .logo{display:block;height:78px;width:auto;max-width:260px;object-fit:contain;margin-bottom:10px;}
  .page .org-name{font-size:19px;font-weight:800;letter-spacing:-0.01em;line-height:1.2;color:${INK};}
  .page .org-line{font-size:11px;color:${MUTED};line-height:1.55;margin-top:3px;max-width:320px;}
  .page .org-gstin{font-size:11px;color:${INK_2};font-weight:600;margin-top:4px;letter-spacing:0.02em;}

  .page .head-r{text-align:right;flex-shrink:0;}
  .page .doc{font-size:23px;font-weight:800;letter-spacing:0.14em;color:${BLUE};line-height:1;}
  .page .doc-rule{height:2px;width:100%;background:${BLUE};margin:9px 0 11px;}
  .page .doc-meta{font-size:11.5px;line-height:1.75;color:${INK_2};white-space:nowrap;}
  .page .doc-meta b{font-weight:700;color:${INK};}
  .page .doc-meta span{color:${MUTED};margin-right:7px;}
  .page .pill{
    display:inline-block;margin-top:11px;padding:5px 13px;border-radius:999px;
    font-size:11.5px;font-weight:800;letter-spacing:0.09em;
    color:${statusTone.fg};background:${statusTone.bg};border:1px solid ${statusTone.border};
  }

  .page .hr{height:1px;background:${LINE};margin:14px 0;}

  /* ── Membership card — the one dark surface on the sheet ── */
  .page .mcard{
    display:flex;justify-content:space-between;align-items:flex-end;gap:24px;
    background:${INK};border-radius:12px;padding:14px 20px;color:#fff;
  }
  .page .mcard-label{
    font-size:9.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${BLUE_ONINK};
  }
  .page .mcard-plan{
    font-size:21px;font-weight:800;letter-spacing:-0.01em;line-height:1.2;margin-top:6px;color:#fff;
  }
  .page .mcard-valid{font-size:12px;color:#C2C9D4;margin-top:5px;}
  .page .mcard-member{font-size:11.5px;color:#8F97A4;margin-top:2px;}
  .page .mcard-member b{color:#DDE2E9;font-weight:600;}
  .page .mcard-right{text-align:right;flex-shrink:0;}
  .page .mcard-amt{font-size:24px;font-weight:800;letter-spacing:-0.02em;line-height:1.1;margin-top:6px;color:#fff;}
  .page .mcard-bal{font-size:11px;font-weight:600;color:#F0C98A;margin-top:5px;}

  /* ── Two-up detail boxes ── */
  .page .cols{display:flex;gap:12px;}
  .page .box{flex:1;min-width:0;border:1px solid ${LINE};border-radius:10px;padding:12px 15px;}
  .page .box-h{
    font-size:9.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;
    color:${MUTED};margin-bottom:9px;
  }
  .page .who{font-size:15px;font-weight:700;color:${INK};line-height:1.3;}
  .page .who-line{font-size:12px;color:${INK_2};margin-top:3px;word-break:break-word;}

  /* ── Line items ── */
  .page table{width:100%;border-collapse:collapse;}
  .page thead th{
    padding:0 10px 8px;font-size:9.5px;font-weight:700;letter-spacing:0.12em;
    text-transform:uppercase;color:${MUTED};border-bottom:1.5px solid ${INK};
  }
  .page thead th:first-child{padding-left:0;}
  .page thead th:last-child{padding-right:0;}
  .page tbody td{padding:9px 10px;border-bottom:1px solid ${LINE};vertical-align:top;font-size:12.5px;}
  .page tbody td:first-child{padding-left:0;}
  .page tbody td:last-child{padding-right:0;}
  .page .c-num{width:26px;color:${MUTED};font-size:11.5px;}
  .page .c-qty{text-align:center;width:44px;color:${INK_2};}
  .page .c-money{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}
  .page .c-total{font-weight:700;}
  .page thead .t-qty{text-align:center;}
  .page thead .t-money{text-align:right;}
  .page .i-name{display:block;font-weight:600;color:${INK};}
  .page .i-sub{display:block;font-size:11px;color:${MUTED};margin-top:2px;}

  /* ── Tax summary + totals ──
     The GST breakdown sits beside the totals rather than stacked above
     them: a tax invoice then costs the same vertical space as a non-tax
     one, which is what keeps both on a single A4 page. */
  .page .sum-row{display:flex;gap:15px;align-items:flex-start;}
  .page .taxbox{flex:1;min-width:0;}
  .page .totals{width:290px;flex-shrink:0;margin-left:auto;}
  .page .t-line{display:flex;justify-content:space-between;gap:14px;padding:4px 0;font-size:12.5px;color:${INK_2};}
  .page .t-line .num{font-variant-numeric:tabular-nums;color:${INK};}
  .page .t-line.t-disc .num{color:${RED};}
  .page .grand{
    display:flex;justify-content:space-between;align-items:baseline;gap:14px;
    margin-top:8px;padding:10px 14px;background:${BLUE_TINT};
    border:1px solid ${BLUE_LINE};border-top:2px solid ${BLUE};border-radius:0 0 8px 8px;
  }
  .page .grand-k{font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${INK};}
  .page .grand-v{font-size:21px;font-weight:800;letter-spacing:-0.02em;color:${BLUE_DEEP};font-variant-numeric:tabular-nums;}
  .page .p-row{display:flex;justify-content:space-between;gap:12px;font-size:12px;line-height:1.75;}
  .page .p-k{color:${MUTED};}
  .page .p-v{font-weight:600;color:${INK};text-align:right;}
  .page .p-status{color:${statusTone.fg};font-weight:800;letter-spacing:0.04em;}
  .page .p-bal{color:${RED};font-weight:700;}

  /* ── Terms ── */
  .page .terms{display:flex;gap:22px;}
  .page .tc{flex:1;min-width:0;}
  .page .tc li{
    position:relative;padding-left:11px;font-size:10px;line-height:1.5;
    color:${MUTED};margin-bottom:3px;
  }
  .page .tc li:before{content:'';position:absolute;left:0;top:5px;width:3px;height:3px;border-radius:50%;background:#B9C6D6;}

  /* ── Footer ── */
  .page .foot{margin-top:auto;padding-top:12px;border-top:1px solid ${LINE};text-align:center;}
  .page .foot-thanks{font-size:12.5px;font-weight:700;color:${INK};}
  .page .foot-sub{font-size:11.5px;color:${BLUE};font-weight:600;margin-top:3px;letter-spacing:0.02em;}
  .page .foot-contact{font-size:10.5px;color:${MUTED};margin-top:8px;line-height:1.7;}

  /* ── Preview scaling: never squash the sheet, scale it ──
     Breakpoints stay below 660px on purpose. html2canvas evaluates media
     queries at a 660px window while building the PDF; anything wider would
     fire during export and change the printed layout. */
  @media screen and (max-width:656px){ body.inv-doc{padding:12px 0;} .page{zoom:0.92;} }
  @media screen and (max-width:608px){ .page{zoom:0.86;} }
  @media screen and (max-width:568px){ .page{zoom:0.80;} }
  @media screen and (max-width:528px){ .page{zoom:0.74;} }
  @media screen and (max-width:488px){ .page{zoom:0.68;} }
  @media screen and (max-width:448px){ .page{zoom:0.62;} }
  @media screen and (max-width:408px){ .page{zoom:0.56;} }
  @media screen and (max-width:368px){ .page{zoom:0.50;} }

  /* ── Print ──
     The printed sheet keeps the same fixed 660px width as the preview and
     centres itself on the paper. It must NOT stretch to width:100%, and it
     must NOT hand its side margins over to the page box.

     Why: nothing guarantees this document gets the page box it asked for.
     It is only ever printed from inside an iframe
     (components/print-preview.js calls iframe.contentWindow.print(); a second
     window traps iOS PWA users — see the note in that file), and Chrome
     resolves the page box for a subframe against the *top* document, not the
     frame's own @page. The print dialog's "Margins: None" overrides CSS
     margins as well. Either route hands the sheet a zero-margin page box.

     The old rules said width:100%;padding:0 and trusted @page for the
     margins, so the sheet stretched from 660px to all 794px of paper and
     printed edge to edge: "INVOICE", the invoice number and the Amount
     column were clipped off the right edge and the logo off the left, while
     the on-screen preview still looked perfect. The exported PDF is
     reproducible with the @page rule deleted and margins set to zero.

     At a fixed 660px the sheet fits inside A4 *and* Letter, with or without
     page margins, so every print route lands on the layout you previewed.
     @page is kept for engines that do honour it here; its 12mm still leaves
     703px of printable width for a 660px sheet, so it can only ever add
     white space, never clip. */
  @page{size:A4 portrait;margin:12mm;}
  @media print{
    body.inv-doc{background:#fff;padding:0;}
    .page{
      width:660px;max-width:660px;margin:0 auto;
      box-shadow:none;zoom:1;
    }
  }
</style>
</head>
<body class="inv-doc">
<div class="page">
  <div class="brandbar"></div>

  <header class="head">
    <div class="head-l">
      ${g.logo_url ? `<img class="logo" src="${escHtml(g.logo_url)}" alt="${escHtml(gymName)}">` : ''}
      <div class="org-name">${escHtml(gymName)}</div>
      ${addressLine ? `<div class="org-line">${addressLine}</div>` : ''}
      ${gstOn ? `<div class="org-gstin">${g.gstin ? `GSTIN ${escHtml(g.gstin)} &nbsp;·&nbsp; ` : ''}SAC 999723 &nbsp;·&nbsp; B2C</div>` : ''}
    </div>
    <div class="head-r">
      <div class="doc">INVOICE</div>
      <div class="doc-rule"></div>
      <div class="doc-meta"><span>No.</span><b>${escHtml(invoiceNo)}</b></div>
      <div class="doc-meta"><span>Date</span><b>${dateStr}</b></div>
      <div class="pill">${payStatus}${payStatus === 'PAID' ? ' ✓' : ''}</div>
    </div>
  </header>

  <div class="hr"></div>

  <section class="mcard" aria-label="Membership summary">
    <div>
      <div class="mcard-plan">${escHtml(planDesc)}</div>
      ${planDateRange ? `<div class="mcard-valid num">${planDateRange}</div>` : ''}
      <div class="mcard-member">Member &nbsp;<b>${escHtml(m.full_name || m.name)}</b></div>
    </div>
    <div class="mcard-right">
      <div class="mcard-label">${amountLabel}</div>
      <div class="mcard-amt num">₹${fmtNum(payStatus === 'PAID' ? amountPaid : netTotal)}</div>
      ${balanceDue > 0 ? `<div class="mcard-bal num">Balance due ₹${fmtNum(balanceDue)}</div>` : ''}
    </div>
  </section>

  <div style="height:14px;"></div>

  <div class="cols">
    <div class="box">
      <div class="box-h">Billed To</div>
      <div class="who">${escHtml(m.full_name || m.name)}</div>
      ${m.phone ? `<div class="who-line num">${escHtml(m.phone)}</div>` : ''}
      ${m.email ? `<div class="who-line">${escHtml(m.email)}</div>` : ''}
    </div>
    <div class="box">
      <div class="box-h">Membership</div>
      ${detailRows}
    </div>
    <div class="box">
      <div class="box-h">Payment</div>
      <div class="p-row"><span class="p-k">Mode</span><span class="p-v">${escHtml(m.payment_mode || m.payMode || '—')}</span></div>
      <div class="p-row"><span class="p-k">Status</span><span class="p-v p-status">${payStatus}</span></div>
      <div class="p-row"><span class="p-k">Amount Paid</span><span class="p-v num">₹${fmtNum(amountPaid)}</span></div>
      ${balanceDue > 0 ? `<div class="p-row"><span class="p-k">Balance Due</span><span class="p-v p-bal num">₹${fmtNum(balanceDue)}</span></div>` : ''}
    </div>
  </div>

  <div style="height:14px;"></div>

  <table>
    <thead>
      <tr>
        <th style="text-align:left;">#</th>
        <th style="text-align:left;">Description</th>
        <th class="t-qty">Qty</th>
        <th class="t-money">Rate</th>
        ${gstOn ? `<th class="t-money">Taxable</th><th class="t-money">GST ${gstPct}%</th>` : ''}
        <th class="t-money">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRowsHTML}</tbody>
  </table>

  <div style="height:14px;"></div>

  <div class="sum-row">
    ${gstOn ? `<div class="box taxbox">
      <div class="box-h">Tax Summary</div>
      <div class="p-row"><span class="p-k">Taxable Value</span><span class="p-v num">₹${fmtNum(taxableAmount)}</span></div>
      <div class="p-row"><span class="p-k">CGST @ ${halfPct}%</span><span class="p-v num">₹${fmtNum(halfGST)}</span></div>
      <div class="p-row"><span class="p-k">SGST @ ${halfPct}%</span><span class="p-v num">₹${fmtNum(halfGST)}</span></div>
      <div class="p-row"><span class="p-k">Total Tax</span><span class="p-v num">₹${fmtNum(totalGST)}</span></div>
    </div>` : ''}
    <div class="totals">
      <div class="t-line"><span>Sub-Total</span><span class="num">₹${fmtNum(totalPrice)}</span></div>
      ${discount > 0 ? `<div class="t-line t-disc"><span>Discount</span><span class="num">–₹${fmtNum(discount)}</span></div>` : ''}
      <div class="grand">
        <span class="grand-k">Total</span>
        <span class="grand-v">₹${fmtNum(netTotal)}</span>
      </div>
    </div>
  </div>

  <div style="height:14px;"></div>

  <div class="box-h">Terms &amp; Conditions</div>
  <div class="terms">
    ${termCol(terms.slice(0, half))}
    ${terms.length > half ? termCol(terms.slice(half)) : ''}
  </div>

  <footer class="foot">
    <div class="foot-thanks">Thank you for choosing ${escHtml(gymName)}</div>
    <div class="foot-sub">Stay fit. Stay healthy.</div>
    ${(addressLine || contactBits.length) ? `<div class="foot-contact">
      ${contactBits.length ? contactBits.join(' &nbsp;·&nbsp; ') : ''}
    </div>` : ''}
  </footer>
</div>
</body>
</html>`;
}

export { buildInvoiceDocument };
