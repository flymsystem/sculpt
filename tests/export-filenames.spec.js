// tests/export-filenames.spec.js
//
// Guards against a regression to the bug where every real download from
// Data & Backup (members CSV, expenses CSV, full JSON backup) was named
// after the gym instead of the export: "D_Sculpt_Fitness_members.csv",
// "sculpt-backup-d-sculpt-fitness-2026-08-26.json" and so on. Since this
// is a single-gym app (see CLAUDE.md "What this is"), the gym name is
// identical on every export the owner will ever produce, so leading with
// it made every download look the same in a downloads folder.
//
// Why this doesn't import backup.js directly: backup.js pulls in
// lib/expenses.js and lib/members.js, which import lib/supabase.js, which
// reads import.meta.env.VITE_SUPABASE_URL at module-eval time. Vite
// resolves that at build time; Playwright's Node test runner (see
// playwright.config.js — tests run against `npm run preview`, not through
// Vite's dev transform) does not, so the bare import throws before any
// test body runs. invoice-print.spec.js gets away with importing
// invoice-template.js because that module's chain never reaches
// lib/supabase.js.
//
// This also can't exercise the real click-to-download path — that needs a
// logged-in dashboard session with real gym data (members, expenses,
// plans), which needs credentials this suite doesn't have (see
// tests/auth-flow.spec.js's skip-without-credentials tests for the same
// constraint).
//
// So instead: pull the actual buildExportFilename() source text out of
// backup.js (not a hand-copied reimplementation — the literal function
// body that ships) and run it standalone. The function is self-contained
// (Date + string templating only, no imports), so this is a faithful
// execution of the real code, not a parallel copy that could drift from
// it silently.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backupSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/pages/dashboard/backup.js'),
  'utf8'
);

const match = backupSrc.match(
  /function buildExportFilename\([\s\S]*?\n\}/
);
if (!match) {
  throw new Error(
    'export-filenames.spec.js could not find buildExportFilename() in backup.js — ' +
    'did it get renamed or restructured? Update the extraction regex above.'
  );
}
// eslint-disable-next-line no-new-func
const buildExportFilename = new Function(`return (${match[0]})`)();

// Freeze "now" so date/time assertions aren't racing the real clock.
// 2026-08-26 09:07 local — single-digit hour/minute on purpose, to catch
// a missing zero-pad (e.g. "907" instead of "0907").
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
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
}

test('sanity: extracted source actually is a function', () => {
  expect(typeof buildExportFilename).toBe('function');
});

test('members CSV filename encodes type and date, no time', () => {
  const name = withFrozenClock(() => buildExportFilename('members', 'csv'));
  expect(name).toBe('dsculpt-members-2026-08-26.csv');
});

test('expenses CSV filename encodes type and date, no time', () => {
  const name = withFrozenClock(() => buildExportFilename('expenses', 'csv'));
  expect(name).toBe('dsculpt-expenses-2026-08-26.csv');
});

test('full backup JSON filename encodes type, date AND zero-padded time', () => {
  // Full backup is the one export plausibly re-run more than once in a
  // day, so it carries -HHmm to keep same-day backups from colliding —
  // see the comment on buildExportFilename() in backup.js.
  const name = withFrozenClock(() => buildExportFilename('full-backup', 'json', { withTime: true }));
  expect(name).toBe('dsculpt-full-backup-2026-08-26-0907.json');
});

test('filenames never carry the gym name', () => {
  const names = withFrozenClock(() => [
    buildExportFilename('members', 'csv'),
    buildExportFilename('expenses', 'csv'),
    buildExportFilename('full-backup', 'json', { withTime: true }),
  ]);
  for (const name of names) {
    expect(name.toLowerCase()).not.toContain('sculpt_fitness');
    expect(name.toLowerCase()).not.toContain('sculpt-fitness');
  }
});

test('two different export types produce two different filenames', () => {
  const [members, expenses] = withFrozenClock(() => [
    buildExportFilename('members', 'csv'),
    buildExportFilename('expenses', 'csv'),
  ]);
  expect(members).not.toBe(expenses);
});

// ── Call-site checks ──────────────────────────────────────────────
// These guard against the three a.download sites drifting back to
// inline gym-name-based filenames (or losing the withTime:true on the
// full backup) without going through buildExportFilename at all — a
// mistake the function-level tests above can't catch since they only
// exercise the helper, not who calls it.
test('members CSV export routes through buildExportFilename', () => {
  expect(backupSrc).toMatch(/downloadCSV\(headers, rows, buildExportFilename\('members', 'csv'\)\)/);
});

test('expenses CSV export routes through buildExportFilename', () => {
  expect(backupSrc).toMatch(/a\.download = buildExportFilename\('expenses', 'csv'\)/);
});

test('full backup JSON export routes through buildExportFilename with withTime', () => {
  expect(backupSrc).toMatch(
    /a\.download = buildExportFilename\('full-backup', 'json', \{ withTime: true \}\)/
  );
});
