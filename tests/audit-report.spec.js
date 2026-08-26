// tests/audit-report.spec.js
//
// Phase D — Financial & GST Audit Support Report (Data & Backup page,
// src/pages/dashboard/backup.js). Same constraint as export-filenames.spec.js:
// backup.js's import chain reaches lib/supabase.js, which reads
// import.meta.env at module-eval time and throws under Playwright's plain
// Node test runner. So this suite does the same thing that file does —
// extract the real source text and either execute the self-contained
// buildExportFilename() function directly, or assert against the literal
// source for things that need a live DB session (a real gym row, real
// payment_history) that this credential-less suite doesn't have.
//
// What matters here, per STATUS-PHASE-D.md:
//   1. The report renamed itself off "Year-End Financial Summary" /
//      "Financial Year <year>" — a claim about a full, closed year no
//      matter how little of it had actually happened — to "Financial &
//      GST Audit Support Report" with a real computed period.
//   2. Every audit CSV filename goes through buildExportFilename(), same
//      helper/convention as the pre-existing members/expenses/backup
//      exports — dsculpt-<type>-<date>.<ext>.
//   3. The report never prints a real-looking GSTIN/PAN when the gym
//      record has none — it must show an explicit "Not supplied" state,
//      not silently omit the field or invent a placeholder-looking value.
//   4. The "not a tax filing" disclaimer is present on the report itself
//      and in the on-screen card describing it.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backupSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/pages/dashboard/backup.js'),
  'utf8'
);

const filenameMatch = backupSrc.match(/function buildExportFilename\([\s\S]*?\n\}/);
if (!filenameMatch) {
  throw new Error('audit-report.spec.js could not find buildExportFilename() in backup.js.');
}
// eslint-disable-next-line no-new-func
const buildExportFilename = new Function(`return (${filenameMatch[0]})`)();

const FIXED_NOW = new Date(2026, 7, 26, 9, 7, 0);
function withFrozenClock(fn) {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(FIXED_NOW);
      return new RealDate(...args);
    }
    static now() { return FIXED_NOW.getTime(); }
  }
  global.Date = FrozenDate;
  try { return fn(); } finally { global.Date = RealDate; }
}

// The AUDIT_CSV_TYPES vocabulary as it ships in backup.js — extracted
// rather than hand-copied so this test fails loudly if the ids drift.
const typesMatch = backupSrc.match(/const AUDIT_CSV_TYPES = (\[[\s\S]*?\n\]);/);
if (!typesMatch) {
  throw new Error('audit-report.spec.js could not find AUDIT_CSV_TYPES in backup.js.');
}
// eslint-disable-next-line no-new-func
const AUDIT_CSV_TYPES = new Function(`return (${typesMatch[1]})`)();

test('the report no longer markets itself as a tax filing', () => {
  // Check the strings actually rendered to the user (card title/button,
  // and the generated document's own <title>/heading) — not the file's
  // explanatory comments, which legitimately name the old title once,
  // in the "root cause" note above this code, as history.
  expect(backupSrc).toMatch(/'Financial & GST Audit Support Report — ' \+ year/);
  expect(backupSrc).toMatch(/Generate Audit Report \(PDF\)/);
  expect(backupSrc).not.toMatch(/'Year-End Financial Summary/);
  expect(backupSrc).not.toMatch(/'Financial Year ' \+ year/);
});

test('the report carries a visible "not a tax filing" disclaimer', () => {
  expect(backupSrc).toMatch(/not a tax filing/i);
  expect(backupSrc).toMatch(/Prepared for audit review/i);
});

test('every AUDIT_CSV_TYPES id produces a dsculpt-<type>-<date> filename', () => {
  for (const t of AUDIT_CSV_TYPES) {
    const name = withFrozenClock(() => buildExportFilename(t.id, 'csv'));
    expect(name).toBe(`dsculpt-${t.id}-2026-08-26.csv`);
  }
});

test('AUDIT_CSV_TYPES covers every category the brief asked for', () => {
  const ids = AUDIT_CSV_TYPES.map(t => t.id);
  const required = [
    'gst-reconciliation', 'tax-breakup', 'b2b-b2c-split', 'sac-wise',
    'place-of-supply', 'itc-information', 'invoice-register',
    'expense-register', 'invoice-sequence-audit', 'cancelled-invoices',
    'credit-debit-notes', 'payment-reconciliation', 'outstanding-balances',
    'audit-trail',
  ];
  for (const id of required) expect(ids).toContain(id);
});

test('GSTIN and PAN render an explicit "Not supplied" state when unset, never a fabricated value', () => {
  // auditIdentityBlock() is the only place the report prints these
  // fields — it must branch on g.gstin / g.pan being falsy and emit the
  // literal "Not supplied" marker, not default to a placeholder-looking
  // string like "22AAAAA0000A1Z5" (the input's own placeholder attribute)
  // or silently drop the row.
  const fnMatch = backupSrc.match(/function auditIdentityBlock\(\)[\s\S]*?\n  \}/);
  expect(fnMatch).toBeTruthy();
  const fnSrc = fnMatch[0];
  expect(fnSrc).toMatch(/g\.gstin \? escHtml\(g\.gstin\) : notSupplied/);
  expect(fnSrc).toMatch(/g\.pan \? escHtml\(g\.pan\) : notSupplied/);
  expect(fnSrc).toMatch(/Not supplied/);
});

test('invoice register and sequence audit are honest about there being no persisted invoice numbers', () => {
  // This schema has no invoices table and genInvoiceNo() (helpers.js)
  // mints a fresh random number per render — never stored. The report
  // must say so rather than presenting a "Reference ID" as if it were a
  // real, auditable invoice sequence.
  expect(backupSrc).toMatch(/invoiceSequenceAudit = notImplemented\(/);
  expect(backupSrc).toMatch(/not an invoice number/);
});

test('sections with no backing data render "not implemented", never fabricated rows', () => {
  for (const id of ['b2b-b2c-split', 'sac-wise', 'itc-information', 'credit-debit-notes']) {
    // Each of these is built via the notImplemented() helper, which always
    // returns rows: [] plus a `note` string — asserting the pairing here
    // (rather than just grepping for the word "implemented" once) makes
    // sure the check tracks a single call, not a stray comment somewhere.
    const re = new RegExp(`const ${id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())} = notImplemented\\(`);
    expect(backupSrc).toMatch(re);
  }
});

test('every audit table gets a per-section CSV download inside the PDF preview', () => {
  expect(backupSrc).toMatch(/function auditSectionHTML\(/);
  expect(backupSrc).toMatch(/Download CSV/);
  expect(backupSrc).toMatch(/csvDataUri\(/);
});

test('the dashboard card also states the disclaimer, not just the generated document', () => {
  const cardMatch = backupSrc.match(/<!-- FINANCIAL & GST AUDIT SUPPORT REPORT -->[\s\S]*?<\/div>\s*<\/div>/);
  expect(cardMatch).toBeTruthy();
  expect(cardMatch[0]).toMatch(/not a tax filing/i);
});
