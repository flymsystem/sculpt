// tests/staff-scanner-only.spec.js
//
// A staff login exists for exactly two things: scanning the rotating
// desk QR to mark that staff member's own attendance (client decision,
// 2026-09-21), and taking walk-in enquiries at the desk (2026-09-22).
// No dashboard, no member list, no money.
//
// The permission matrix is the single source of truth for that — the
// sidebar, the section guard in dashboard/index.js's nav(), and the FAB
// all read it — so these tests assert against the matrix itself plus
// the two places that could reintroduce a way around it. They need NO
// login and touch NO data: lib/permissions.js is a pure module and the
// rest is a source read, same style as tests/build-integrity.spec.js.
//
// The end-to-end half (a real staff session actually landing on the
// scanner) lives in tests/checkin.spec.js, which needs SCULPT_STAFF_*
// credentials.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) =>
  readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

test('staff have no permission except the scanner and the enquiry desk', async () => {
  const { can, getVisibleSections } = await import('../src/lib/permissions.js');

  const granted = getVisibleSections('staff');
  expect(granted, 'a staff session must reach exactly two sections')
    .toEqual(['checkin-scan', 'enquiries']);

  // Spot-check the ones that would actually hurt, by name, so a future
  // key added to the matrix as truthy is caught rather than averaged
  // away by a count assertion.
  for (const action of [
    'dashboard', 'members', 'add_member', 'edit_member', 'delete_member',
    'payments', 'renew_member', 'finance', 'expenses', 'plans',
    'plans_showcase', 'attendance', 'staff_management', 'settings',
    'backup', 'analytics', 'reports',
  ]) {
    expect(can('staff', action), `staff must not have '${action}'`).toBe(false);
  }

  expect(can('staff', 'checkin_scan')).toBe(true);

  // Enquiries are 'limited', never 'full'. The difference is Remove and
  // Convert-to-member, and Convert is the one that matters structurally:
  // it opens the Add Member modal, which reads S.members / S.plans /
  // S.addonTemplates — none of which a staff session ever fetches.
  expect(can('staff', 'leads')).toBe('limited');
  expect(can('owner', 'leads')).toBe('full');
});

test('the enquiry page gates Remove and Convert on full access, in markup and in the handler', () => {
  const js = src('src/pages/dashboard/enquiries.js');

  expect(js).toMatch(/const canManage = can\(S\.role \|\| 'owner', 'leads'\) === 'full';/);

  // Both buttons must be absent from the markup for staff …
  expect(js).toMatch(/\$\{canManage && e\.status !== 'Converted' \?/);
  expect(js).toMatch(/\$\{canManage \? `<button class="btn btn-sm" data-enq-del=/);

  // … and hiding them must not be the only thing stopping the action,
  // since the delegated handler would otherwise fire for any injected
  // or devtools-restored button.
  expect(js).toMatch(/if \(delBtn\).*if \(canManage\) confirmDeleteEnquiry/);
  expect(js).toMatch(/if \(convertBtn\).*if \(canManage\) convertToMember/);
});

test('the owner is not offered a scanner that can only fail', async () => {
  const { can, getVisibleSections } = await import('../src/lib/permissions.js');

  // sculpt_staff_checkin resolves the caller via staff.user_id, and an
  // owner has no staff row — an owner scan can only ever return
  // NOT_STAFF. Offering the page is how this feature looks broken when
  // it is working. The owner keeps the two check-in pages that do work.
  expect(can('owner', 'checkin_scan')).toBe(false);

  const ownerSections = getVisibleSections('owner');
  expect(ownerSections).not.toContain('checkin-scan');
  expect(ownerSections).toContain('checkin-display');
  expect(ownerSections).toContain('checkins');
});

test('nav() clamps a staff session to its two sections at the single choke point', () => {
  const js = src('src/pages/dashboard/index.js');

  // Every navigation — sidebar, command palette, popstate, a tapped
  // push, a hand-typed /dashboard/finance — goes through nav(). Clamping
  // it there is what makes the rule hold for all of them at once, and
  // anything outside the allowlist lands on the scanner rather than
  // erroring.
  expect(js).toMatch(/const STAFF_SECTIONS = new Set\(\['checkin-scan', 'enquiries'\]\);/);
  expect(js).toMatch(/if\s*\(S\.role === 'staff' && !STAFF_SECTIONS\.has\(id\)\)\s*id = 'checkin-scan';/);

  // And the shell itself must return before any of the owner apparatus
  // is built, including loadData() — hiding the member list while still
  // fetching every member's name and phone into the browser would be
  // the worse half of the change.
  expect(js).toMatch(/if\s*\(S\.role === 'staff'\)\s*\{\s*renderStaffShell\(router\);\s*return;/);

  // Index by regex, not by an exact string: this file is checked out
  // with CRLF on Windows, so a '\n' in the needle never matches.
  const shellAt = js.search(/renderStaffShell\(router\);\s*return;/);
  const loadDataAt = js.indexOf('await loadData()');
  expect(shellAt, 'staff shell branch not found').toBeGreaterThan(-1);
  expect(loadDataAt, 'loadData() call not found').toBeGreaterThan(-1);
  expect(shellAt, 'the staff branch must return before loadData() runs').toBeLessThan(loadDataAt);
});

test('the staff shell keeps its navigation outside the container nav() overwrites', () => {
  const js = src('src/pages/dashboard/index.js');
  const shell = js.slice(js.indexOf('function renderStaffShell('), js.indexOf('// ── Data loading'));

  // nav() replaces #gym-content's innerHTML on every navigation. A tab
  // bar rendered inside it would delete itself on the first tap, and a
  // staff session has no sidebar to fall back on.
  const tabbarAt = shell.indexOf('class="staff-tabbar"');
  const contentAt = shell.indexOf('id="gym-content"');
  expect(tabbarAt, 'staff tab bar not found').toBeGreaterThan(-1);
  expect(contentAt, '#gym-content not found in the staff shell').toBeGreaterThan(-1);
  expect(
    shell.slice(contentAt).indexOf('class="staff-tabbar"'),
    'the tab bar must not be inside #gym-content'
  ).toBeGreaterThan(-1);
  expect(shell).toMatch(/<div class="app-content" id="gym-content">[\s\S]*?<\/div>\s*<nav class="staff-tabbar"/);

  // The active tab is announced, not just tinted — it is the only
  // navigation a staff session has.
  expect(js).toMatch(/setAttribute\('aria-current', on \? 'page' : 'false'\)/);

  // Icon-only logout needs a label; the tab bar needs both icon and text.
  expect(shell).toMatch(/aria-label="Sign out"/);
  expect(shell).toContain('staff-tab-label');
});

test('the check-ins log merges staff scans in, and only real scans', () => {
  const js = src('src/pages/dashboard/checkins.js');

  // Staff attendance lives in a different table with a different shape;
  // the owner asking "did the desk QR work?" should not have to know that.
  expect(js).toMatch(/import \{ getAttendanceRange \} from '\.\.\/\.\.\/lib\/staff\.js'/);
  expect(js).toMatch(/function mergeRows\(/);

  const merge = js.slice(js.indexOf('function mergeRows('));

  // A staff_attendance row with no check_in is the owner having marked
  // someone Present by hand in the Daily Attendance grid — a roster
  // fact, not a scan. Putting it in a log of scans misreports who was
  // actually at the desk.
  expect(merge).toMatch(/if \(!r\.check_in\) continue;/);

  // staff_attendance stores a date and a `time`; without synthesising a
  // timestamp from both, every staff row sorts to midnight and clumps
  // at the bottom of its day.
  expect(merge).toMatch(/sortAt: new Date\(`\$\{r\.date\}T\$\{String\(r\.check_in\)/);
  expect(merge).toMatch(/sort\(\(a, b\) => b\.sortAt - a\.sortAt\)/);
});

test('the scanner offers a way to start a new scan after every outcome', () => {
  const js = src('src/pages/dashboard/checkin-scan.js');

  // handleDecode() stops the scanner on ANY terminal result, so after a
  // successful check-in the camera is off. A staff session has no
  // sidebar to navigate away and back through — only the shell's two
  // buttons — so a success that offers no "Scan Again" leaves a trainer
  // unable to scan out at the end of the day without reloading.
  const showResult = js.slice(js.indexOf('function showResult('));
  expect(showResult).toContain('id="checkin-scan-again"');
  expect(
    showResult.slice(0, showResult.indexOf('}')),
    'Scan Again must not be conditional on the result being an error'
  ).not.toMatch(/\$\{\s*!ok\s*\?/);
});
