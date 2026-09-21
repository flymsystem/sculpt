// tests/staff-scanner-only.spec.js
//
// A staff login exists for exactly one thing: scanning the rotating
// desk QR to mark that staff member's own attendance. No dashboard, no
// member list, no money (client decision, 2026-09-21).
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

test('staff have no permission except the check-in scanner', async () => {
  const { can, getVisibleSections } = await import('../src/lib/permissions.js');

  const granted = getVisibleSections('staff');
  expect(granted, 'a staff session must reach exactly one section').toEqual(['checkin-scan']);

  // Spot-check the ones that would actually hurt, by name, so a future
  // key added to the matrix as truthy is caught rather than averaged
  // away by a count assertion.
  for (const action of [
    'dashboard', 'members', 'add_member', 'edit_member', 'delete_member',
    'payments', 'renew_member', 'finance', 'expenses', 'leads', 'plans',
    'plans_showcase', 'attendance', 'staff_management', 'settings',
    'backup', 'analytics', 'reports',
  ]) {
    expect(can('staff', action), `staff must not have '${action}'`).toBe(false);
  }

  expect(can('staff', 'checkin_scan')).toBe(true);
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

test('nav() pins a staff session to the scanner at the single choke point', () => {
  const js = src('src/pages/dashboard/index.js');

  // Every navigation — sidebar, command palette, popstate, a tapped
  // push, a hand-typed /dashboard/finance — goes through nav(). Pinning
  // it there is what makes the rule hold for all of them at once.
  expect(js).toMatch(/if\s*\(S\.role === 'staff'\)\s*id = 'checkin-scan';/);

  // And the shell itself must return before any of the owner apparatus
  // is built, including loadData() — hiding the member list while still
  // fetching every member's name and phone into the browser would be
  // the worse half of the change.
  expect(js).toMatch(/if\s*\(S\.role === 'staff'\)\s*\{\s*renderStaffScannerShell\(router\);\s*return;/);

  // Index by regex, not by an exact string: this file is checked out
  // with CRLF on Windows, so a '\n' in the needle never matches.
  const shellAt = js.search(/renderStaffScannerShell\(router\);\s*return;/);
  const loadDataAt = js.indexOf('await loadData()');
  expect(shellAt, 'staff shell branch not found').toBeGreaterThan(-1);
  expect(loadDataAt, 'loadData() call not found').toBeGreaterThan(-1);
  expect(shellAt, 'the staff branch must return before loadData() runs').toBeLessThan(loadDataAt);
});

test('the scanner offers a way to start a new scan after every outcome', () => {
  const js = src('src/pages/dashboard/checkin-scan.js');

  // handleDecode() stops the scanner on ANY terminal result, so after a
  // successful check-in the camera is off. This page is now the whole
  // of a staff session, with no sidebar to navigate away and back
  // through, so a success that offers no "Scan Again" leaves a trainer
  // unable to scan out at the end of the day without reloading.
  const showResult = js.slice(js.indexOf('function showResult('));
  expect(showResult).toContain('id="checkin-scan-again"');
  expect(
    showResult.slice(0, showResult.indexOf('}')),
    'Scan Again must not be conditional on the result being an error'
  ).not.toMatch(/\$\{\s*!ok\s*\?/);
});
