# Batch 3 — Status

## Run header
- Start: 2026-08-26 (local session start)
- Branch: `sculpt-whitelabel`
- End: TBD
- Commits: TBD (see per-phase sections below once merged)
- Pushed: NOT YET — only after build+lint+playwright all pass, per RUN MODE rules
- Migrations: tracked per-phase below as they land

## Orchestration plan (recorded before execution, per Step 0.4)

Given the size of this job (DB migrations + a full dashboard UI/UX pass +
member portal fixes + a rewritten audit report + real landing content +
a real photo pipeline), it is being run as one orchestrating session
(me) dispatching **phase-owning agents in isolated git worktrees**, each
with a self-contained brief, so independent phases can proceed in
parallel without touching each other's files. I (the orchestrator) merge
each worktree branch back into `sculpt-whitelabel` myself, resolve any
conflicts, run the full check suite, and decide on the push per the
RUN MODE gate.

**Wave 1 (parallel, independent file sets):**
- Agent A — Phase A (blocking bugs: photo persistence, QR scan flicker,
  hold-to-exit, backup filenames) **+** Phase B (member portal FAB /
  overlap issues) — grouped together because both touch
  `checkin-scan.js`, `qr.js`, `src/pages/member/index.js`.
  Migration numbers reserved: 126+.
- Agent C — Phase C (dashboard UI/UX: sidebar, overview, members,
  member-modals, enquiries, support section, staff attendance, alerts,
  finance). No DB changes expected.
- Agent EF — Phase E (landing content) + Phase F (real photographs).
  Grouped because F's asset swap and E's content edits both land in
  `landing.js` / `index.html`. No DB changes expected.

**Wave 2 (sequential, after Wave 1 is merged):**
- Agent D — Phase D (year-end/audit report rewrite in `backup.js` +
  report generator). Sequenced after Wave 1 because Phase A's A4
  (backup filenames) also touches `backup.js` — avoids a guaranteed
  merge conflict and, more importantly, avoids two agents applying
  live-DB migrations concurrently (D needs new `gyms` columns for
  GSTIN/PAN/legal name).

**Final:** orchestrator merges everything, runs
`npm run build`, `npm run lint`, `npx playwright test`,
`node scripts/verify-schema.mjs`, `qa-responsive`, `qa-nav`, `qa-dashboard`,
hard-refreshes a deep route against `npm run preview`, then pushes only
if everything is green.

## DONE

**Wave 1 merged into `sculpt-whitelabel` and fully re-verified after merge.**
Full per-item detail lives in the phase status files, kept in the repo root
for the record: `STATUS-PHASE-A-B.md`, `STATUS-PHASE-C.md`,
`STATUS-PHASE-EF.md`.

- **A1** Member photo does not persist → root cause: `members.photo_url`
  never existed as a live column (uploads succeeded, the DB write silently
  failed, and the reader view had no such column either) → files:
  `member-modals.js`, `photo.js`, migration `126_member_photo_url_column.sql`
  → verified: migration applied + confirmed live via
  `information_schema.columns` and `pg_get_viewdef`; storage RLS re-checked
  and already correct (120 already covers `member-photos`).
- **A2** Expired-member scan flicker → re-audited; the documented fix
  (stop scanner on every terminal outcome) was already correctly in place
  in all three files. Added `window.__sculptRouter` test hook +
  `tests/member-scan-debounce.spec.js`, which passes, proving no
  overlapping-RPC path exists today. No production bug found to fix.
- **A3** Kiosk hold-to-exit unreliable → root cause: no
  `setPointerCapture`, so finger drift off the button during a genuine
  hold fired `pointerleave` and silently cancelled it → file:
  `checkin-display.js` → `setPointerCapture` + pointer-id ownership +
  `lostpointercapture`/`visibilitychange`/scroll cancel paths added; also
  fixed a latent bug where the hold ran 2.5s while the UI claimed 3s →
  build/lint clean, 5 new tests written (skip without test creds — needs
  Steven to run for real, see below).
- **A4** Backup filenames all identical → root cause: filename always led
  with the (invariant) gym name → file: `backup.js`, new
  `buildExportFilename()` helper → verified via
  `tests/export-filenames.spec.js` (9/9 passing) extracting and executing
  the real helper under a frozen clock. PDF report filenames (a separate
  code path, `showPrintPreview`'s document `<title>`) intentionally left
  untouched — out of A4's scope, noted for Phase D/whoever touches that.
- **B1/B2** FAB overlaps member portal Visits tab / leaks "Add Member"
  into member routes → one root cause: the dashboard FAB is appended to
  `document.body`, outside `#root`, and was never torn down on
  navigation → file: `dashboard/index.js` → registered its cleanup with
  the existing router cleanup registry → verified via
  `member-portal-responsive.spec.js`'s dedicated FAB-leak assertion
  (passing).
- **B3** Member portal responsive audit → found and fixed a real bug: a
  long list (e.g. many receipts) grew the whole page instead of
  scrolling internally, pushing the bottom nav off-screen (missing
  `min-height:0` on a flex child) → file: `member/index.js` → verified
  via a dedicated scroll-metrics test that failed before, passes after.
- **C1–C9** Full dashboard UI/UX pass — mobile sidebar (scroll lock,
  Escape/back-close, populated the empty Support section), overview KPI
  period labels + en-IN formatting, All Members action-icon overflow menu
  + sticky header/actions, member modal footer hierarchy + sticky footer,
  enquiries card rebuild (no more overlap under 480px), staff attendance
  loading/error/empty states, alerts primary-action fix + reminder
  cooldown, finance period-label/chart-label agreement + CSV export. Full
  per-item root-cause/file/verification table in `STATUS-PHASE-C.md`.
  One item explicitly deferred: a true card layout for All Members on
  mobile (currently a scrollable table, not full cards) — flagged as not
  finished in that file.
- **E1–E6** Landing page real content — `GYM` object filled with the real
  phone/WhatsApp/email/Instagram/address/hours; WhatsApp CTA fires a real
  `wa.me` deep link immediately; lazy IntersectionObserver-gated Google
  Maps embed; real footer links; trimmed section spacing; scrollspy nav
  active state; `popstate` same-page-anchor guard re-verified with a new
  regression test. `index.html`'s meta/OG/Twitter/JSON-LD carry the real
  address, phone, geo and hours.
- **F** Real photographs — `PHOTOS/`'s 4 images mapped: `main` → hero,
  `sub photo 1` → about, `sub photo 2`/`sub photo 3` → 2 of the 4
  training slots (Strength & Conditioning, Cardio & Conditioning);
  `prep-landing-images.mjs` rewritten to read from `PHOTOS/`; 1200×630
  `og-share.jpg` generated and wired to `og:image`; hero confirmed full
  colour, interior shots confirmed duotone. Personal Training and Group
  Classes slots **still use the original stock images** — no real photo
  supplied for them (see NEEDS STEVEN).

**Post-merge verification (this session, against the merged tree):**
- `npm run build` — succeeds, no errors.
- `npm run lint` — exactly the 12 pre-existing `no-unused-vars` errors,
  0 new.
- `npx playwright test` — **60 passed, 28 skipped, 0 failed.** All skips
  are the documented credential gap (`SCULPT_TEST_EMAIL`/`PASSWORD` /
  staff test account not set in this environment) — same class already
  documented in CLAUDE.md/HANDOVER.md, just a larger set of tests sharing
  it now that this batch added more credentialed tests.
- `node scripts/verify-schema.mjs` — tables and removed-features sections
  clean; the RPC "MISSING" section is the pre-existing documented
  anon-key/OpenAPI-endpoint limitation noted in HANDOVER.md's Pending
  section, unrelated to this batch — ignored per that note.
- `node scripts/qa-responsive.mjs` — clean at all 8 widths (1600→375) on
  `/` and `/login`.
- `node scripts/qa-nav.mjs` — clean at all 8 widths; burger menu, both
  logins, intro fade all present and separated as expected.
- Hard-refresh of `/dashboard/finance` against `npm run preview` — serves
  real HTML (`Content-Type: text/html`, correct `<head>`), not the
  blank-page failure mode CLAUDE.md warns about.

## PENDING / NOT DONE

- **Phase D** (year-end/audit report rewrite) — not started yet at the
  time of this write-up; dispatched next, sequentially, since it also
  touches `backup.js` (A4 already changed it) and needs new `gyms`
  columns (GSTIN/PAN/legal name) applied to the same live DB Wave 1's A1
  migration already touched.
- **7 new credentialed tests are written but unexecuted for real**
  (`member-photo-persist.spec.js` ×2, `checkin-kiosk-exit.spec.js` ×5) —
  they skip cleanly with no failures, but need
  `SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD` (+ a staff test account) to
  get an actual live pass/fail. This environment never had those
  credentials.
- **C's deferred item**: All Members table on mobile is a scrollable
  table with token-scale sizing, not a true card layout — the brief asked
  for "cards, not a squeezed table" on mobile/tablet; the agent judged
  the sticky-header/overflow-menu/sizing fixes sufficient for now and
  explicitly deferred the full card conversion as a larger follow-up
  rather than rush it. Recorded as open in `STATUS-PHASE-C.md`.
- **Real-device/manual verification not possible in this environment**
  for: kiosk hold-to-exit on an actual touchscreen, backup filename
  click-downloads in a real browser, iPhone camera/scan behaviour
  (Safari has no BarcodeDetector), and A2's flicker if it's still
  reproducible live (the code audit found no remaining overlapping-RPC
  path — a live repro would need a screen recording to diagnose further,
  possibly a stale service-worker chunk on the affected device).
- **No browser-rendered screenshots were captured** for Phase C or E/F in
  this pass — verification was build/lint/test + direct code/CSS tracing
  (Phase C agent had no way to reach an authenticated dashboard session;
  Phase EF's agent did use a browser tool for the landing page). Real
  before/after screenshots at 375/390/768/1024/1440px, as the brief's
  "Finish with" section #3 asks for, are still outstanding.

## ASSUMPTIONS I MADE
- **PHOTOS folder contents.** Only 4 images exist in `PHOTOS/`:
  `landing page - main.png` (1459×1078), `sub photo 1.png` (1190×1322),
  `sub photo 2.png` (1295×1214), `sub photo 3.png` (1402×1122). The
  brief asks for 6 output slots (hero, about, train-1..4). Assumption:
  `main` → hero, `sub photo 1` → about, `sub photo 2` and
  `sub photo 3` → two of the four training slots, and the remaining two
  training slots keep their existing (stock) images until real photos
  for them exist, rather than inventing or duplicating content — flagged
  under NEEDS STEVEN.
- Worktree-based parallel execution instead of one linear session, for
  the reasons above. Chosen over doing all six phases serially myself
  because the total scope (~8,000+ lines across just the files Phase C
  alone touches) makes serial single-session execution impractical to
  finish and verify at production quality in one pass.

## NEEDS STEVEN
- Only 4 of 6 needed photo slots have source images (see assumption
  above) — 2 more training photos needed (Group Classes, plus one more)
  to fully retire the stock template images.
- GSTIN, PAN, legal entity name, registered address for the audit
  report (Phase D) — these get added as Gym Settings fields with a
  visible "not supplied" state, per the brief; real values needed from
  Steven.
- A physical iPhone test for camera/scan behaviour (Safari has no
  BarcodeDetector) and for the hold-to-exit gesture on a real touchscreen.

## CHECKS (final, after merge)
(filled in at the end)
