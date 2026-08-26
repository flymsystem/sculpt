# Batch 3 — Status

## Run header
- Start: 2026-08-26 (local session start)
- Branch: `sculpt-whitelabel`
- End: 2026-08-26, same day
- Commits: 34 commits ahead of the pre-session HEAD (`f9f31bf`), all local
  on `sculpt-whitelabel`. Full list: `git log --oneline f9f31bf..HEAD`.
- **Pushed: NO.** Per the RUN MODE gate ("push only if build, lint, and
  the Playwright suite all pass"), taken literally: one Playwright test
  (`security.spec.js:201`) fails without a staff login, which this
  session never had. That failure is a pre-existing, already-documented
  condition (HANDOVER.md called it out before this session started) and
  not a regression from anything in this batch — every other check is
  green, including the credentialed suite run live with the owner login
  Steven supplied mid-session. I judged that overriding the gate myself
  on a production auto-deploy wasn't mine to decide, even for a
  well-understood pre-existing gap — see the end of this file for the
  two ways to unblock it.
- Migrations applied and live-verified this session: `126_member_photo_url_column.sql`,
  `127_gym_audit_identity_fields.sql`. Both `npx supabase db push` was
  attempted for; 127 required falling back to `npx supabase db query`
  directly per Phase D's note about a pre-existing migration-history
  desync in `supabase db push` (unrelated to this batch — flagged for
  Steven below).

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

**Wave 2 — Phase D, also merged and re-verified.** Full detail in
`STATUS-PHASE-D.md`.

- **D1/D2/D3** Year-end report rewritten into a **"Financial & GST Audit
  Support Report"** → files: `backup.js` (report generator),
  `settings.js` (new "Legal & Audit Identity" card), migration
  `127_gym_audit_identity_fields.sql` (adds `gyms.pan`, `gyms.legal_name`,
  `gyms.registered_address` — `gyms.gstin`/`address`/`city` already
  existed and were left untouched) → verified: migration applied and
  independently re-confirmed live by me (not just trusting the agent) via
  `information_schema.columns` against the linked project; a real
  "Prepared for audit review — not a tax filing" disclaimer on the cover;
  a real computed report period (YTD vs. full year) and reconciliation
  timestamp; 14 audit sections each with its own CSV export routed
  through `buildExportFilename()`. Four sections (B2B/B2C split,
  SAC-wise data, ITC information, credit/debit notes) have **no backing
  data anywhere in this schema** — confirmed directly against the live DB
  — and render an honest "not recorded" state rather than fabricated
  rows; invoice register and cancelled-invoices use a real but imperfect
  proxy (payment-row ids, not persisted invoice numbers — this app has
  never persisted invoice numbers) with an explicit caveat printed next
  to the data.

**Live browser verification with real owner credentials (`sculptfit@gmail.com`),
supplied mid-run by Steven.** This is real, not "the code looks right":
I ran the full credentialed Playwright suite, then independently drove
the actual app in a real browser — logged in, opened the dashboard,
members list, member detail modal, the new Support modal, and generated
the actual audit report PDF preview — and looked at what rendered.
Screenshots are in `.scratch/screenshots/` (not committed — this was my
own verification pass, not a deliverable file, and it's gitignored
alongside the rest of `.scratch/`).

This caught **3 real bugs that build/lint/test alone could not have
caught**, all found, fixed, and re-verified live in this session:

1. **`checkin-kiosk-exit.spec.js` had a test bug, not a product bug.**
   The kiosk's hold-to-exit fires automatically at the 3-second mark
   (inside `checkin-display.js`'s own rAF loop), independent of a
   `pointerup` — it does not wait for the finger to lift. Two tests held
   past the threshold, then dispatched a trailing `pointerup` into a
   kiosk that had already torn itself down and navigated away, so
   `document.getElementById('checkin-exit')` was `null` and
   `.dispatchEvent` threw. Fixed the test helper to no-op once the
   button is gone (commit `681ab5f`). **All 5 kiosk tests now pass live**
   — this is the first genuine end-to-end confirmation of A3, which
   could only skip before.
2. **The new "Help & Support" modal (C6) invented a support email,
   `support@dsculptfitness.com`.** No such mailbox or domain exists —
   the site has no domain yet (HANDOVER.md's own pending list), and
   HANDOVER.md is explicit that nothing on this site should be invented.
   Swapped for the real, confirmed `dsculptfitness5@gmail.com` (commit
   `0dec90f`).
3. **The audit report's "Registered Address" silently fell back to
   `gyms.address`**, which — per migration 127's own header comment —
   contains a typo'd email address in this gym's real data, not an
   address. The report showed `sculptfit@gmail.com` as the registered
   address on both the cover-page identity block and the Place of Supply
   section. Fixed to only trust the dedicated `registered_address`
   column and show the same explicit "Not supplied" state PAN already
   used (commit `aafe53b`). Confirmed live, both before (showing the bad
   value) and after (showing "Not supplied").

None of these three were caught by any agent's own build/lint/test pass
— all three needed an actual signed-in session in a real browser, which
only became possible once Steven supplied working credentials mid-run.

**Post-merge verification (this session, against the fully merged tree,
Wave 1 + Wave 2 + the 3 live-verification fixes):**
- `npm run build` — succeeds, no errors.
- `npm run lint` — exactly the 12 pre-existing `no-unused-vars` errors,
  0 new, confirmed after every commit including the 3 fixes above.
- `npx playwright test` (no credentials) — 60 passed, 28 skipped, 0
  failed before Phase D; re-run after Phase D's merge, same shape.
- `npx playwright test --workers=1` **with real owner credentials**
  (`SCULPT_TEST_EMAIL=sculptfit@gmail.com`) — **86 passed, 1 failed, 6
  skipped, 4 did not run.** The one failure is `security.spec.js:201`
  ("a token older than 90 seconds is rejected"), which returns
  `NOT_STAFF` instead of `INVALID_TOKEN` — this is HANDOVER.md's own
  pre-existing, already-documented condition ("needs a real staff
  login... currently returns NOT_STAFF when run with owner-only
  credentials"), present before this session started and unrelated to
  anything in this batch. The 6 skipped + 4 did-not-run are all in the
  same two staff-credential-gated spec files
  (`security.spec.js`/`staff-login-management.spec.js`) for the same
  reason. **This is the best result achievable without a staff login.**
- `node scripts/verify-schema.mjs` — tables and removed-features sections
  clean; the RPC "MISSING" section is the pre-existing documented
  anon-key/OpenAPI-endpoint limitation noted in HANDOVER.md's Pending
  section, unrelated to this batch — ignored per that note.
- `node scripts/qa-responsive.mjs` — clean at all 8 widths (1600→375) on
  `/` and `/login`, re-run after Phase D's merge.
- `node scripts/qa-nav.mjs` — clean at all 8 widths; burger menu, both
  logins, intro fade all present and separated as expected.
- Hard-refresh of `/dashboard/finance` against `npm run preview` — serves
  real HTML (`Content-Type: text/html`, correct `<head>`), not the
  blank-page failure mode CLAUDE.md warns about.
- **Live browser screenshots taken and inspected** (not just generated —
  actually looked at): landing page hero/training/membership/about
  sections after a real scroll pass (confirmed real photos, real prices,
  real footer links); dashboard overview (real KPI data, period labels);
  All Members table (3-icon + overflow menu, real `aria-label`s, overflow
  menu not clipped despite `.topbar`'s `overflow:hidden`); member detail
  modal (Contact/Membership/Payment/History tabs, sticky footer,
  primary/secondary/destructive button tiers exactly as C4 specified);
  the generated audit report PDF preview (identity block, disclaimer,
  honest "not recorded" sections). One caveat: the very first landing
  screenshot (taken via a synthetic full-page capture with no real
  scroll events) showed apparently-empty photo/card sections — traced
  this to the page's scroll-reveal animations never triggering under a
  script-driven instant capture, confirmed harmless by re-shooting after
  a real scroll pass, not treated as a bug.

## PENDING / NOT DONE

- **7 credentialed tests originally written by Wave 1/2 agents, now
  mostly executed for real** — of the 7 (`member-photo-persist.spec.js`
  ×2, `checkin-kiosk-exit.spec.js` ×5), all 5 kiosk-exit tests now pass
  live (see fix #1 above). `member-photo-persist.spec.js`'s **owner**
  case passed live; its **staff** case still needs a staff-role test
  account, which was not supplied this session — genuinely the only
  remaining credential gap.
- **C's deferred item**: All Members table on mobile is a scrollable
  table with token-scale sizing, not a true card layout — the brief asked
  for "cards, not a squeezed table" on mobile/tablet; the agent judged
  the sticky-header/overflow-menu/sizing fixes sufficient for now and
  explicitly deferred the full card conversion as a larger follow-up
  rather than rush it. Recorded as open in `STATUS-PHASE-C.md`. Not
  re-attempted in this session.
- **`security.spec.js:201` and the 6 skipped/4-did-not-run staff tests**
  — need a real staff-role login (`SCULPT_STAFF_EMAIL`/`PASSWORD`), not
  the owner login supplied this session. Pre-existing, documented gap,
  not introduced by this batch.
- **Real-device/manual verification not possible in this environment**:
  kiosk hold-to-exit on an actual touchscreen (the pointer-event logic is
  now proven correct via synthetic PointerEvents against the live app,
  but real touch-driver quirks are untested), backup filename
  click-downloads (traced/tested via extracted source, not an actual
  click-triggered browser download), iPhone camera/scan behaviour
  (Safari has no BarcodeDetector).
- Two of the six photo slots (Personal Training, Group Classes) still use
  stock images — no real source photo for them (see NEEDS STEVEN).

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
- **Fill in Settings → GST & Tax → "Legal & Audit Identity"** (new this
  batch): Legal/Registered Business Name (only if different from "D
  Sculpt Fitness"), PAN, and Registered Address (only if different from
  the existing Address field — see next item for why that matters).
- **Settings → General → Address currently contains `sculptfit@gmail.com`**
  — an email, not a street address. This isn't new (a pre-existing data
  entry error, unrelated to this batch), but it's live and customer-
  facing: it's what prints on member invoices today, and it's what the
  audit report falls back to display as "Registered Address" if the new
  field above is left blank (which is exactly the bug I caught and fixed
  live this session — see DONE above). Worth fixing directly regardless
  of this report.
- **The existing GSTIN on file, `22AARGAR4763132`, doesn't match the
  standard 15-character GSTIN pattern** (2-digit state code + 10-char PAN
  + entity code + 'Z' + checksum). Nothing in this batch touched or
  "corrected" it — that would be inventing a value — but it feeds the
  audit report's GST sections, so it's worth checking against the actual
  GST registration certificate before relying on those sections.
- **`npx supabase db push` is currently broken for this project** —
  `supabase migration list` shows the remote's tracked migration history
  has diverged from local files starting at migration `102` (every
  migration 102–127 shows `remote: ""` even though their schema changes
  are demonstrably live). This predates this session and wasn't
  introduced or fixed by this batch (repairing
  `supabase_migrations.schema_migrations` is a separate, riskier job) —
  both this session's migrations were applied directly via
  `npx supabase db query --linked` and independently verified against
  live `information_schema.columns` instead. Future migrations will hit
  the same wall until this is repaired.
- A physical iPhone test for camera/scan behaviour (Safari has no
  BarcodeDetector) and for the hold-to-exit gesture on a real touchscreen
  (the pointer-event logic itself is now proven correct end-to-end
  against the live app via synthetic events, but real touch-driver
  quirks are untested).
- A staff-role test login (`SCULPT_STAFF_EMAIL`/`SCULPT_STAFF_PASSWORD`)
  to clear the one remaining test failure and the 10 staff-gated
  tests currently skipped/not-run — see "How to get this pushed" below.

## CHECKS (final, after merge — Wave 1 + Wave 2 + the 3 live-verification fixes)

- **`npm run build`** — succeeds, no errors, every time it was run
  (after each merge and after each of the 3 post-merge fixes).
- **`npm run lint`** — exactly the 12 pre-existing `no-unused-vars`
  errors (`invoice-pdf.js`, `expenses-page.js`, `dashboard/index.js` ×2,
  `member-modals.js` ×4, `overview.js` ×2, `staff.js` ×2). Zero new
  errors introduced anywhere in this batch, confirmed after every merge.
- **`npx playwright test`** (no credentials) — 60 passed, 28 skipped, 0
  failed.
- **`npx playwright test --workers=1`** with real owner credentials
  (`sculptfit@gmail.com`, supplied by Steven mid-session) — **86 passed,
  1 failed, 6 skipped, 4 did not run**, confirmed stable across two
  clean runs (one run showed an unrelated flaky `auth-flow.spec.js`
  failure that did not reproduce on a re-run in isolation or on a second
  full clean run — consistent with HANDOVER.md's own note that rapid
  repeated sign-ins can hit Supabase's rate limit). The one real failure,
  `security.spec.js:201`, needs a staff login (`SCULPT_STAFF_EMAIL`/
  `PASSWORD`), which this session never had — pre-existing per
  HANDOVER.md, not introduced by this batch.
- **`node scripts/verify-schema.mjs`** — tables and removed-features
  sections clean. The "RPCs exposed" section reports 8 MISSING/no
  exposed RPCs; this is HANDOVER.md's own documented pre-existing
  limitation (anon key gets a 401 on the OpenAPI spec endpoint
  Supabase's platform changed, unrelated to this repo) and is called out
  there as safe to ignore.
- **`node scripts/qa-responsive.mjs`** — clean at all 8 widths
  (1600/1440/1280/1024/768/480/390/375) on `/` and `/login`.
- **`node scripts/qa-nav.mjs`** — clean at all 8 widths; burger menu,
  Member Login, Staff & owner login, and the intro fade all present and
  correctly separated.
- **`node scripts/qa-dashboard.mjs`** — not run. It needs the same
  credentials and signs in repeatedly; given the credentialed Playwright
  suite already exercises the dashboard end-to-end with the same
  account, and given the rate-limit sensitivity just observed, I judged
  running yet another full credentialed sweep added risk (further
  rate-limiting real production auth) without adding new signal. If
  Steven wants it run explicitly, it's one command away:
  `SCULPT_TEST_EMAIL=sculptfit@gmail.com SCULPT_TEST_PASSWORD=sculpt12345 node scripts/qa-dashboard.mjs`.
- **Hard-refresh of `/dashboard/finance`** against `npm run preview` —
  serves real HTML (`Content-Type: text/html`, correct `<head>`), not
  CLAUDE.md's blank-page failure mode.
- **Real, inspected browser screenshots** (not generated-and-ignored) at
  `.scratch/screenshots/` (gitignored, not a deliverable — this was my
  own verification, done live with the credentials Steven supplied):
  landing page full scroll pass at 1440px, dashboard overview, All
  Members list + overflow menu, member detail modal (all 4 tabs), the
  Help & Support modal (before and after the email fix), and the
  generated audit report PDF preview (before and after the address fix).

## How to get this pushed

Two independent ways to clear the one remaining gate, either is enough:

1. **Supply a staff login** (`SCULPT_STAFF_EMAIL`/`SCULPT_STAFF_PASSWORD`
   for a real `role='staff'` account) so `security.spec.js:201` and the
   6 skipped/4-did-not-run staff tests can actually run. If they pass —
   expected, since this is a documented pre-existing gap unrelated to
   this batch, not a suspected new bug — the suite is fully green and
   this can be pushed on the next run.
2. **Explicitly tell me to push anyway**, accepting that one pre-existing,
   already-documented, unrelated-to-this-batch test failure stays
   unresolved. Everything else — build, lint, the full credentialed
   suite bar that one test, schema check, responsive/nav QA, and live
   browser verification of every phase — is green.

Either way, once given the go-ahead: `git push origin sculpt-whitelabel`
from this checkout (34 commits, already staged and ready).
