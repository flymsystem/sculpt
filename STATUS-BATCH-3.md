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
(filled in as phases land)

## PENDING / NOT DONE
(filled in as phases land)

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
