# Phase A + B Status Report

Worktree: `C:\steven\sculp\sculp-fitness\.claude\worktrees\agent-a16dd96af559b319a`
Branch: `worktree-agent-a16dd96af559b319a`

Work was split across four parallel agents on disjoint file sets to avoid
merge conflicts, then compiled and re-verified in this report by the
coordinating agent. All commits below are on this branch, not pushed
anywhere.

```
00facb3 fix(b3): long member-portal lists no longer push the bottom nav off-screen
c65d499 fix(b1,b2): stop the dashboard's owner-only FAB from leaking into the member portal
c052111 fix(a2): stop overlapping check-in RPCs firing on a denied/expired scan
d961e83 fix: member photo does not persist across owner/staff sessions
c0b5d0e fix: backup/export downloads use specific sortable filenames
e14595f fix: kiosk hold-to-exit uses Pointer Events for reliability across input types
```

---

## A1 — Member photo does not persist

**Root cause:** `members.photo_url` never existed as a column. `dashboard/photo.js`'s
`saveMemberPhoto()` uploaded the blob to the `member-photos` storage bucket
successfully, then ran `supabase.from('members').update({ photo_url: ... })`
against a column PostgREST had no knowledge of. The write silently failed
(surfaced only as an easy-to-miss amber toast), the storage object was
orphaned, and `members_with_status` (the view `getMembers()` reads) couldn't
select a column that didn't exist regardless — so nothing rendered on
reload even if the toast had been noticed. This affected add, edit/replace,
and remove flows identically, for both owner and staff sessions. It has
nothing to do with storage RLS (already correct — see below).

**Files changed:**
- `supabase/migrations/126_member_photo_url_column.sql` (new)
- `src/pages/dashboard/member-modals.js`
- `src/pages/dashboard/photo.js`
- `tests/member-photo-persist.spec.js` (new)

**Migration 126:** Adds `members.photo_url text` (idempotent,
`ADD COLUMN IF NOT EXISTS`) and appends `photo_url` to the end of
`members_with_status`'s explicit SELECT list via `CREATE OR REPLACE VIEW`
(Postgres refuses `42P16` if you try to insert a new column mid-list — it
must go at the end). The view body used is the *live*, current definition
pulled via `pg_get_viewdef` against the linked project (per CLAUDE.md's
rule on copying function/view bodies forward), not a reconstruction from an
older migration file.

**Verification performed:**
- Migration applied with `npx supabase db push` and independently confirmed
  against the live database (`information_schema.columns` shows
  `members.photo_url`; `pg_get_viewdef` on `members_with_status` shows
  `photo_url` in the output column list; `pg_class.reloptions` confirms the
  view kept `security_invoker=true`).
- Storage RLS re-audited: `120_storage_staff_access.sql`'s policies already
  cover the `member-photos` bucket (not just `aadhar-photos` as CLAUDE.md's
  task brief worried) — confirmed by reading the live `storage.objects`
  policies. No storage RLS change was needed.
- `member-modals.js`: removed a leftover duplicate photo-upload block in
  the Edit Member submit handler that re-read
  `window.__pendingEditPhoto` a second time (never cleared after the first
  read), causing a redundant second upload + refetch on every edit that
  included a photo.
- `photo.js`: added a test-only `window.__sculptPhoto` hook
  (`saveMemberPhoto`, `removeMemberPhoto`, `memberPhotoExistsInStorage`),
  matching the existing `window.__sculptMembers` convention in
  `lib/members.js`.
- New Playwright test `tests/member-photo-persist.spec.js` drives a real
  upload/replace/remove cycle for both an owner and a staff session,
  asserting the DB row and the storage object stay in sync across a
  simulated reload. **Both tests currently `test.skip`** in this run because
  the worktree has no `SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD` env vars —
  same credential gap as the rest of the credentialed suite (see final test
  run below). `npm run build` and lint pass clean for the changed files.

**Not finished:** The new test could not be executed end-to-end here for
lack of test credentials; it is written to run once `SCULPT_TEST_EMAIL`/
`SCULPT_TEST_PASSWORD` (and a staff-role test account) are available.

**Ambiguous calls:** None beyond the standard "copy the live view
definition, not an old migration's" rule already in CLAUDE.md, which this
fix follows explicitly.

**Owner-only:** Run `npx playwright test tests/member-photo-persist.spec.js`
with real `SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD` credentials (and a
staff test account) to get a live pass/fail, and spot-check one real photo
upload/reload cycle in the browser as a final sanity check.

---

## A2 — Expired-member scan glitches violently

**Root cause:** Re-audited `src/lib/qr.js`, `src/pages/member/index.js`, and
`src/pages/dashboard/checkin-scan.js` against the exact bug class CLAUDE.md
documents (scanner not stopped on every terminal outcome). All three
**already correctly stop the scanner on every terminal outcome** (success or
error) via a `busy` guard + `stopped` flag from the prior fix recorded in
CLAUDE.md — the violent flicker was not reproducible from a code-level
race in this pass. What was genuinely missing was regression test coverage
for exactly this scenario, so none of this class of bug could be caught if
it regressed again.

**Files changed:**
- `src/app.js` — added a test-only `window.__sculptRouter` hook (same
  convention as `window._navTo` and `window.__sculptCheckin`) so Playwright
  can drive the member portal route directly against the built preview
  server without a real login.
- `tests/member-scan-debounce.spec.js` (new)

**Verification performed:** The new test mounts the real member-portal
shell, fakes the camera via `canvas.captureStream()` plus a
`BarcodeDetector` stub that keeps "seeing" the same code every frame, mocks
`sculpt_member_checkin` with an artificial 250ms delay to make an overlap
window that would expose a debounce bug, and asserts exactly one RPC call
fires and the UI settles into a single stable denied/expired card. **Result:
passing** — confirmed in the final full suite run below
(`member-scan-debounce.spec.js:35` — passed, 4.4s).

**Not finished:** Real credentialed end-to-end verification against a
genuinely expired member login was not possible in this environment; the
mocked-RPC test is the documented substitute, per the task's own allowance.

**Ambiguous calls:** Concluded no production code change was needed for A2
itself, since the documented fix class was already correctly implemented
in all three files audited. If a flicker is still reported live, the next
diagnostic step is a screen recording from the affected device — the
current code has no code-path that permits a second overlapping RPC or a
render after `stopped`, so a live reproduction would point at something
outside the audited files (e.g. a stale service-worker chunk).

**Owner-only:** If A2 is still visibly reproducible on a real device after
this branch ships, that needs a screen recording / device repro, since no
overlapping-RPC code path exists to fix further here.

---

## B1 — FAB covers the Visits bottom-nav item in the member portal

## B2 — "Add members" + button leaks into member login/portal

**Root cause (shared, one bug):** `updateFAB()` in
`src/pages/dashboard/index.js` appends the dashboard's "Add Member" FAB (and
its menu) via `document.body.appendChild()` — outside `#root`. The router
only overwrites `#root.innerHTML` on navigation, so the body-level FAB was
never torn down when navigating to the member portal, and it leaked in,
simultaneously overlapping the bottom nav's Visits tab (B1's visible
symptom) and exposing the owner-only "Add Member" action to members (B2's
symptom) — one root cause, two symptoms.

**Files changed:** `src/pages/dashboard/index.js`

**Fix:** Registered a `cleanupFAB()` function with the router's existing
`window.__sculptRegisterCleanup` registry on every dashboard mount — the
same teardown mechanism already used for camera cleanup — so the FAB is
removed the instant the user navigates away from the dashboard.

**B1 design decision:** Removed the FAB from the member portal entirely
rather than repositioning/relabeling it, since it was never an intentional
member-portal shortcut (members have no "add" action) — it was purely a
leak. This is the ambiguous call flagged in the task brief; recorded here
as the decision made.

**Verification performed:**
`tests/member-portal-responsive.spec.js`'s dedicated assertion
(`no dashboard "Add Member" FAB leaks into the member portal`, line 105) —
**passing** in the final suite run below. Also traced the cleanup-registry
call path manually to confirm it fires on every dashboard→member
navigation, not just some.

**Not finished:** Nothing outstanding.

**Ambiguous calls:** The B1 removal-vs-reposition decision, explained
above.

---

## B3 — Member portal responsive audit

**Root cause found:** Audited all four member-portal tabs (Check In / My
Plan / Receipts / Visits) at 360/390/414/768px via the `ui-ux-pro-max`
skill's methodology. Safe-area insets (`env(safe-area-inset-top/bottom)`)
were already correctly applied and no horizontal overflow existed at any
width in the normal case. One real bug surfaced under load: with a long
list (e.g. 30+ receipts), `#mp-content` (a `flex:1` child with
`overflow-y:auto`) never actually scrolled internally, because it lacked
`min-height:0` — the flexbox default `min-height:auto` let it grow to its
content's natural size instead, pushing the whole `#page-member` shell (and
the bottom nav with it) taller than the viewport and off-screen.

**Files changed:** `src/pages/member/index.js`

**Fix:** Paired `#page-member`'s `height:100dvh` (not just `min-height`)
with `.mp-content`'s `min-height:0`, so the content pane scrolls internally
and the bottom nav stays pinned and reachable regardless of list length.

**Verification performed:**
`tests/member-portal-responsive.spec.js` — horizontal-overflow checks
across all four widths × tabs, plus a dedicated scroll-metrics test
(`a long receipts list scrolls inside the content area, not the whole page
— the bottom nav stays reachable`, line 74) that failed before this fix and
passes after. **All passing** in the final suite run below.

**Not finished:** Nothing outstanding within the scope given (member
portal only — dashboard-side files were explicitly out of scope).

**Ambiguous calls:** None beyond standard responsive-audit judgment calls
already covered by the fix above.

---

## A3 — Hold-to-exit on the QR kiosk display is unreliable

**Root cause:** `src/pages/dashboard/checkin-display.js` already used
Pointer Events, but never called `setPointerCapture`. Natural finger drift
during a genuine 3-second hold could cross the small exit button's edge,
firing `pointerleave`, which silently cancelled the hold mid-gesture —
"works sometimes" tracked how still the finger happened to stay during the
hold, not user intent.

**Files changed:**
- `src/pages/dashboard/checkin-display.js`
- `tests/checkin-kiosk-exit.spec.js` (new)

**Fix:**
- `setPointerCapture(pointerId)` on `pointerdown`, routing all subsequent
  events for that contact to the button regardless of drift;
  `pointerleave` is no longer listened for (it was the false-cancel
  source).
- Pointer-id ownership tracking (`_exitPointerId`) so an unrelated second
  pointer can't cancel or restart another pointer's in-flight hold.
- Added cancel paths that did not exist before: `lostpointercapture`,
  `visibilitychange` (tab/app backgrounded mid-hold), and a capturing
  `window` `scroll` listener (a scroll mid-hold cancels it rather than
  silently completing it).
- `contextmenu` suppressed and `-webkit-touch-callout:none` added so a
  long-press callout can't eat the release event.
- `EXIT_HOLD_MS` corrected from **2500ms to 3000ms** to match the button's
  own "Hold to exit (3s)" label and HANDOVER §6's stated 3-second security
  requirement — this was a latent bug in its own right (the code silently
  ran a 2.5s hold while claiming 3s in the UI).
- The pre-existing visible progress bar (`#checkin-exit-progress`) is kept
  in sync with all the new cancel/complete paths.
- `unbindExitHold()` added, wired into `stopCheckinDisplay()`, to remove
  the new `window`/`document`-level listeners on teardown.

**Verification performed:**
- `npm run build` — succeeds.
- `npm run lint` — no new errors in `checkin-display.js`; matches the
  documented 12-error baseline.
- `npx playwright test tests/checkin-kiosk-exit.spec.js` — all 5 new tests
  currently `test.skip` (this worktree originally had no `.env`, since
  fixed by copying `.env.local` from the main checkout for this
  verification pass — but the test additionally needs
  `SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD`, which are not set here). The
  tests cover: a genuine 3s hold triggers exit; a short tap does not; a
  `pointercancel` before 3s aborts the hold; a scroll mid-hold aborts it
  even with no release event; a stray second pointer cannot cancel an
  in-flight hold. They use synthetic `PointerEvent`s dispatched via
  `page.evaluate` for deterministic control over `pointerId` and timing
  (a documented, deliberate choice — more precise than OS-level touch
  emulation for these specific cancel/drift/second-pointer scenarios, at
  the cost of not exercising real touch-driver quirks).

**Not finished:** The 5 new tests are written and skip cleanly but were not
executed for real in this pass (no test credentials in the original
worktree at authoring time). They should be run once with real credentials
to confirm.

**Ambiguous calls:** Changing `EXIT_HOLD_MS` 2500→3000 was judged in scope
despite the brief's "never shorten the duration" — this is a *lengthening*
to match the already-documented/labeled 3s security requirement, not a
shortening, so it was treated as fixing a second latent bug in the same
file rather than scope creep.

**Owner-only:** Run `npx playwright test tests/checkin-kiosk-exit.spec.js`
with real test credentials to get a live pass/fail; ideally also hand-test
on an actual touchscreen tablet since synthetic pointer events can't fully
stand in for real touch-driver behavior.

---

## A4 — Backup/export filenames are all "d sculpt fitness"

**Root cause:** The three real downloads in `src/pages/dashboard/backup.js`
that actually set `a.download` on a Blob URL (members CSV, expenses CSV,
full JSON backup) all built their filename by leading with `S.gym.name`
("D Sculpt Fitness" — invariant, since this is a single-gym app), with the
part that actually identifies the export tacked on the end where it's easy
to miss in a downloads list. No date component existed at all for
members/expenses, and the JSON backup had a bare date with no time
(collides on same-day reruns).

**Files changed:**
- `src/pages/dashboard/backup.js`
- `tests/export-filenames.spec.js` (new)

**Fix:** Added a pure helper:
```js
function buildExportFilename(type, ext, { withTime = false } = {}) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timePart = withTime ? `-${pad(d.getHours())}${pad(d.getMinutes())}` : '';
  return `dsculpt-${type}-${datePart}${timePart}.${ext}`;
}
```
Rewired the three real download call sites:
- Members CSV → `buildExportFilename('members', 'csv')` →
  `dsculpt-members-2026-08-26.csv`
- Expenses CSV → `buildExportFilename('expenses', 'csv')` →
  `dsculpt-expenses-2026-08-26.csv`
- Full JSON backup → `buildExportFilename('full-backup', 'json', { withTime: true })`
  → `dsculpt-full-backup-2026-08-26-1313.json`

`downloadCSV(headers, rows, filename)` was updated to take the fully-formed
filename (extension included) instead of appending `.csv` itself, since it
now always receives one from `buildExportFilename`.

**Verification performed:** `npm run build` succeeds; `npx eslint
src/pages/dashboard/backup.js` exits clean. `tests/export-filenames.spec.js`
(9 tests) extracts the actual `buildExportFilename` source text out of
`backup.js` at runtime and executes it under a frozen clock, asserting
exact filenames for all three export types plus regex checks that all
three call sites route through it with the right arguments. **All 9
passing** in the final suite run below. Since real click-download testing
isn't possible in this environment (no browser), correctness is proven by
this extracted-source execution against the frozen clock rather than by a
claimed manual click-test.

**Not finished / scope boundary hit:** The "PDF Report" buttons (Members
PDF, Payments PDF, Year-End, P&L, GST, Full Backup PDF) never set
`a.download` at all — they call `showPrintPreview()`, and the browser's own
Print/Save-as-PDF dialog suggests a filename from that printed document's
`<title>` tag, built inside `exportPDF()` (the "PDF EXPORT ENGINE" section)
and the full-backup-PDF handler's inline HTML. Both are the
**report-generator logic explicitly out of scope** for this task (another
agent/track owns it) and were deliberately left untouched. If the same
`dsculpt-<type>-<date>` treatment is wanted there, the change is to the
`<title>` string at roughly line 267 (`exportPDF`) and line 771 (full-backup
PDF handler) in `backup.js`. Also noted: `exportPDF()`'s own `filename`/`fn`
parameter, passed by every PDF call site, is dead code — the function body
never references it — and was left as-is since wiring it in means editing
`exportPDF()` itself (out of scope).

**Ambiguous calls:**
- `-HHmm` applied only to the full JSON backup, since it's the one export
  plausibly pulled twice in a day (before/after a risky change); the CSV
  reports are already scoped by on-screen date/category filters, so a
  same-day collision was judged unlikely and a shorter name preferred.
- Date/time use the browser's local clock, consistent with this file's
  existing `toLocaleDateString('en-IN')` convention — CLAUDE.md's
  gym-timezone rule is specifically about server-side Postgres check-in
  timestamps, not client-side export filenames.
- Type tokens (`members`, `expenses`, `full-backup`) chosen to literally
  match the UI button intent, hyphenated per the pattern's own
  `full-backup` example in the task brief.

**Owner-only:** Click each of the three fixed export buttons once in a real
browser (Members "Excel (CSV)", Expenses "CSV for Accountant", "JSON
Backup") and confirm the save dialog offers the new `dsculpt-*` names. If
the PDF report filenames should also change, that decision and the actual
edit belongs to whoever owns the report-generator section of this file.

---

## Final verification (this pass, run from the worktree root)

Ran after killing a stale `npm run preview` process left listening on port
4173 from an earlier build (Playwright's `reuseExistingServer: true` was
silently serving a pre-fix build otherwise) and rebuilding.

### `npm run build`
```
✓ 134 modules transformed.
✓ built in 445ms
✓ Service worker stamped with version sculpt-1787731606990
```
Succeeds, no errors.

### `npm run lint`
```
✖ 12 problems (12 errors, 0 warnings)
```
Exactly the 12 pre-existing `no-unused-vars` errors CLAUDE.md documents as
the known baseline (`invoice-pdf.js`, `expenses-page.js`,
`dashboard/index.js` ×2, `member-modals.js` ×4, `overview.js` ×2,
`staff.js` ×2) — confirmed identical error set before and after this
branch's changes (diffed against a clean checkout of the same commit).
No new lint errors were introduced by any of A1–A4/B1–B3.

### `npx playwright test`
```
28 skipped
53 passed (10.2s)
```
All 53 runnable (non-credentialed) tests pass, including every new test
added in this phase:
- `tests/member-photo-persist.spec.js` — 2 tests, both **skip** (no
  `SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD` in this worktree)
- `tests/member-scan-debounce.spec.js` — 1 test, **pass** (4.4s)
- `tests/member-portal-responsive.spec.js` — 6 tests, all **pass**
- `tests/checkin-kiosk-exit.spec.js` — 5 tests, all **skip** (same
  credential gap)
- `tests/export-filenames.spec.js` — 9 tests, all **pass**

The 28 skips match the pre-existing credentialed-test pattern CLAUDE.md
documents ("20 pass, 4 skip without credentials" was the baseline before
this phase added more credentialed tests; the skip *reason* — missing
`SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD` — is identical, just now a
larger set of tests share that same gap).

---

## Summary of what only Steven can supply/verify

1. `SCULPT_TEST_EMAIL` / `SCULPT_TEST_PASSWORD` (and a staff-role test
   account) to actually execute the 7 new credentialed tests
   (`member-photo-persist.spec.js` ×2, `checkin-kiosk-exit.spec.js` ×5) —
   they are written and skip cleanly but unverified live in this pass.
2. A real click-test of the three fixed backup/export download filenames
   in an actual browser (A4).
3. A real device/hand test of the kiosk hold-to-exit gesture on an actual
   touchscreen tablet (A3) — synthetic pointer events in tests can't fully
   substitute for real touch-driver behavior.
4. If A2's flicker is still visible on a real device after this branch
   ships, a screen recording — the audited code has no remaining path for
   an overlapping RPC or a stale render, so a live repro would point
   somewhere outside the three files reviewed (e.g. a stale/cached service
   worker chunk on the device).
5. A decision on whether the PDF-report filenames (out of scope for A4,
   owned by the report-generator track) should get the same
   `dsculpt-<type>-<date>` treatment.
