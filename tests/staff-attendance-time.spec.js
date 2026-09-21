// tests/staff-attendance-time.spec.js
//
// Regression guard for the bug that made staff attendance look broken:
// a QR scan recorded the time correctly and the UI then threw it away.
//
// staff_attendance.check_in / check_out are `time without time zone`,
// so sculpt_staff_checkin's original `(now() AT TIME ZONE tz)::time`
// stored full microsecond precision — "06:07:23.481712". The only
// place those columns are ever displayed is the Daily Attendance grid
// in src/pages/dashboard/staff.js, which puts them in an
// <input type="time">. HTML's value sanitization allows at most THREE
// fractional-second digits, so the browser silently replaced the value
// with "". The owner saw "Present" beside an empty time box, and the
// next press of Save Attendance read that empty box back and wrote
// NULL over the real scan — the data was destroyed by looking at it.
//
// Three things have to stay true for that to stay fixed, and no single
// one of them is sufficient on its own:
//
//   1. The browser contract this all hinges on is what we think it is.
//   2. The SQL truncates on write (migration 131).
//   3. The grid normalizes on read, for rows written before 131 ran.
//
// Needs NO login and touches NO data — (1) runs in a blank page, (2)
// and (3) read the source files, the same static-guard style as
// tests/build-integrity.spec.js.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) =>
  readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

test('an HTML time input silently discards a microsecond-precision value', async ({ page }) => {
  // This is the whole mechanism of the bug, pinned so it cannot quietly
  // stop being true. If a future browser starts ACCEPTING six-digit
  // fractional seconds this test fails — at which point the fix is
  // still correct, but the reasoning in migration 131 needs updating
  // rather than silently rotting.
  await page.setContent(`
    <input id="micro"  type="time" value="06:07:23.481712">
    <input id="secs"   type="time" value="06:07:23">
    <input id="mins"   type="time" value="06:07">
  `);

  const values = await page.evaluate(() =>
    ['micro', 'secs', 'mins'].map((id) => document.getElementById(id).value)
  );

  expect(values[0], 'microsecond precision must still be the rejected case this fix is about').toBe('');
  expect(values[1]).toBe('06:07:23');
  expect(values[2]).toBe('06:07');
});

test('sculpt_staff_checkin truncates the time it writes to whole seconds', () => {
  const sql = src('supabase/migrations/131_staff_checkin_second_precision.sql');

  // The write path, not just any date_trunc anywhere in the file.
  expect(
    sql,
    'v_local_time must be truncated on write — a bare ::time cast reintroduces the bug'
  ).toMatch(/v_local_time\s*:=\s*date_trunc\('second'/);

  // The backfill that repairs rows written before this migration ran.
  expect(sql).toMatch(/UPDATE\s+staff_attendance[\s\S]*date_trunc\('second',\s*check_in\)/i);
});

test('the Daily Attendance grid normalizes times instead of reading the column raw', () => {
  const js = src('src/pages/dashboard/staff.js');

  expect(js, 'timeForInput() is the client-side half of the fix').toContain('function timeForInput(');

  // Every time input must go through it. A bare `r.check_in` back in a
  // value= attribute is exactly the regression this guards.
  const timeInputs = js.match(/<input type="time"[^>]*value="\$\{[^}]*\}"/g) || [];
  expect(timeInputs.length, 'expected the four check-in/check-out inputs').toBe(4);
  for (const tag of timeInputs) {
    expect(tag, `time input reads the column without normalizing: ${tag}`).toContain('timeForInput(');
  }
});

test('upsertAttendance does not send notes when the caller has none', () => {
  const js = src('src/lib/staff.js');

  // PostgREST writes exactly the columns present in the body, so an
  // unconditional `notes: null` wiped the row's note every time the
  // notes-less Daily Attendance grid pressed Save.
  expect(js).not.toMatch(/notes:\s*txt\(notes\)\s*\|\|\s*null,/);
  expect(js).toMatch(/if\s*\(notes\s*!==\s*undefined\)\s*payload\.notes\s*=/);
});
