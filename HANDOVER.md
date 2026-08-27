# D Sculpt Fitness — Handover

Everything you need to run, deploy and maintain this app. Written for
someone who is not a full-time developer: every command says where it runs.

---

## 1. What this is

A gym management app for **D Sculpt Fitness**, plus its public website.

| Piece | Where it runs |
|---|---|
| Website + dashboard | Vercel, auto-deployed from the `sculpt-whitelabel` branch on GitHub (`github.com/flymsystem/sculpt`) |
| Database, logins, storage | Supabase |

**Stack:** plain JavaScript (no framework) built by Vite, Supabase for the
backend, installable as a phone app (PWA).

---

## 2. Your accounts

| Thing | Value |
|---|---|
| Supabase account | `sculp.flym@gmail.com` |
| Supabase organization | `D Sculpt Fitness` (free plan) |
| Supabase project | `sculp-fitness` |
| Project ref | `acigxzbbchhisaymklld` |
| Dashboard | https://supabase.com/dashboard/project/acigxzbbchhisaymklld |
| Region | `ap-northeast-2` (Seoul) |
| Owner login (the app) | `sculptfit@gmail.com` |
| Gym code | `DSCULPT` (was documented here as `SCULPT01` until 2026-08-27 — that value was never correct and caused every member login to fail during the client demo; see the 2026-08-27 entry below) |

> **The backend moved accounts on 2026-08-23.** The project used to sit in
> Steven's personal Supabase account; it was **transferred** into the
> `D Sculpt Fitness` organization owned by `sculp.flym@gmail.com`. A
> transfer moves the project intact — the project ref, URL, anon key,
> service_role key, database, storage and Edge Functions are all unchanged,
> which is why nothing in `.env.local` or in the Vercel environment
> variables needed touching and no redeploy was required.
>
> The personal account remains an Owner of the organization so it can still
> administer the project. Removing it from Organization Settings → Team is
> a deliberate act, not housekeeping — do it only when you're sure
> `sculp.flym@gmail.com` is the account that will be maintaining this.

> **Change the owner password.** It is currently `sculpt12345`, which is
> weak and was sent in chat. The **database** password has also been sent
> in chat and should be reset at the same time (Settings → Database →
> Reset database password; nothing in the app reads it, so a reset is
> safe). Supabase dashboard → Authentication → Users →
> click the user → Reset password. Do this before anyone else gets access.

The **anon key** in `.env.local` is public by design — it ships inside the
website and is protected by row-level security, not secrecy. The
**service_role key** is the dangerous one: it bypasses all security. Never
put it in `.env.local` or any file under `src/`.

> **`.env.local` is not tracked in git.** It was accidentally committed at
> the project baseline and has since been removed from tracking
> (`git rm --cached`) — `.gitignore` excludes `.env.local` and `.env*`.
> Running `vercel link` or `vercel env pull` writes a live
> `VERCEL_OIDC_TOKEN` into this file; that must never end up in a commit.
> If `git status` ever shows `.env.local` as a tracked change, stop and
> untrack it again before committing anything.

---

## 3. Deploying

**Deploys are automatic.** Vercel is connected to the GitHub repo
(`github.com/flymsystem/sculpt`) and watches the `sculpt-whitelabel`
branch — every `git push` to that branch triggers a new production
deployment. There is nothing to upload by hand.

```
git push origin sculpt-whitelabel
```

That's the whole deploy. Vercel runs `npm run build` (pinned in
`vercel.json`, output directory `dist`) and aliases the result to
**https://sculp-fitness.vercel.app** within about a minute.

To deploy from your own machine without waiting on a push (useful for
checking a fix before committing), the Vercel CLI does the same build:

```
npx vercel --prod
```

The CLI needs the same certificate workaround as `vercel login` on a
machine running Kaspersky (or any TLS-inspecting antivirus) — see the
PowerShell notes below.

**Before pushing**, build and smoke-test locally the same way as before:

```
npm run build
npm run preview
```

Open http://localhost:4173, then **hard-refresh** (Ctrl+Shift+R) on a deep
page like `/dashboard/finance`. If it loads, the build is good. If it goes
blank, stop — see "Things that will break it" below.

**Environment variables** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
live in the Vercel project settings
(`vercel.com/flymsystems-projects/sculp-fitness/settings/environment-variables`),
scoped to Production, Preview and Development. They are not read from
`.env.local` in the deployed build — that file only matters for
`npm run dev` on your own machine. To change them:

```
npx vercel env add VITE_SUPABASE_URL production
```

(re-run once per environment you want to update; the CLI prompts for the
new value rather than taking it as an argument, so it never appears in
your shell history).

If the site looks stale after a deploy, it's almost always the **service
worker** caching the previous build in the visitor's browser, not a bad
deploy — a hard refresh (or a second normal refresh) clears it. `/unstick/`
still exists as a manual fallback that clears the old cached version.

---

## 4. Running the checks

```
npm run build          # must succeed
npx playwright test    # 24 automated checks
```

The tests that need a login are skipped unless you provide credentials:

```
SCULPT_TEST_EMAIL=sculptfit@gmail.com SCULPT_TEST_PASSWORD=... npx playwright test --workers=1
```

`--workers=1` matters: those tests each sign in, and several sign-ins at
once hit Supabase's rate limit and fail as if the app were broken.

To check the database still matches what the code expects:

```
node scripts/verify-schema.mjs
```

**Responsive checks.** These need `npm run preview` running in another
terminal. They walk the widths 1600 / 1440 / 1280 / 1024 / 768 / 480 /
390 / 375 and fail on horizontal overflow or a JS error:

```
node scripts/qa-responsive.mjs   # landing + login
node scripts/qa-nav.mjs          # logo size, Member Login, intro fade
```

The dashboard sweep signs in, so it needs the same credentials:

```
SCULPT_TEST_EMAIL=sculptfit@gmail.com SCULPT_TEST_PASSWORD=... node scripts/qa-dashboard.mjs
```

---

## Migrations 114–124: applied and verified

As of 2026-08-23, migrations `114` through `124` are all applied to
production and verified directly against the live database (function
bodies read via `pg_get_functiondef`, not assumed from the migration
files — see `supabase/migrations/README.md` for what each one does).
`create-staff-user` and `manage-staff-login` are both deployed
(`supabase functions list` shows both ACTIVE).

Notable ones from this batch:

- `118_member_phone_unique.sql` had to be applied by hand in this same
  session — it was missing despite being bundled with "114–123 applied,"
  confirmed by `ux_members_gym_phone_active` not existing in
  `pg_indexes`. No duplicate active phone numbers existed, so it was
  safe to apply directly; re-verified after (index exists, all phones
  normalised to `+91XXXXXXXXXX`, `sculpt_add_member` has the
  duplicate-key error handler).
- `124_fix_renew_expiry_no_op_join_date.sql` fixes a real regression
  found while verifying `122` end-to-end: renewing an expired member
  whose stored `join_date` already equalled the renewal's computed
  join_date (e.g. same-day trial→paid, or a second same-day renewal)
  silently left `expiry_date` unchanged — `122`'s "only recompute when
  join_date/duration change" trigger guard saw no change and did
  nothing, and `sculpt_renew_member` never set `expiry_date` itself.
  Fixed by having the RPC set it explicitly, same formula the trigger
  uses.

The check-in feature (`111_fix_returns_table_column_shadowing.sql`
onward) is confirmed working — `sculpt_issue_checkin_token` /
`sculpt_member_checkin` / `sculpt_manual_checkin` all fixed and applied.
The `checkin.spec.js:24`/`:33` failures from an earlier session were a
test-authoring bug, not a product bug: those tests signed in as the
*owner*, who has no `staff` row, so `sculpt_staff_checkin` legitimately
returned `NOT_STAFF` every time. `tests/checkin.spec.js` now requires
`SCULPT_STAFF_EMAIL`/`SCULPT_STAFF_PASSWORD` (a real staff login) and
fails loudly if the account it's given isn't actually staff, instead of
silently testing nothing. `tests/_diag-checkin-token.spec.js` (the
temporary diagnostic that first proved this) has been deleted.

**`manoj.sculpt@gmail.com` staff account** — corrected note: it
**does** have a matching `gym_users` row (`role = 'staff'`), and
`staff.is_active` / `staff.login_enabled` are both `true`. The "no
matching `gym_users` row" problem this file used to describe is gone —
no SQL fix is needed. The only thing actually missing is a known
password: nobody currently knows what it is. To make this account
usable for testing, use the app itself — Staff page → this row →
Manage Login → Reset Password (owner-only, via the deployed
`manage-staff-login` Edge Function) — no direct SQL required.

---

## 2026-08-24: QR check-in flicker fix, member portal redesign, landing page fixes

Pushed to `sculpt-whitelabel` (commit `470cd80`), not yet applied to the
database beyond what auto-deploys from the frontend build (see the gym
display name pending item above for the one DB change still outstanding).

- **QR check-in flicker fixed** (`src/pages/member/index.js`,
  `src/pages/dashboard/checkin-scan.js`). Both the member and staff
  scanners used to stop the camera only on a *successful* check-in — an
  expired-token or network error left the camera running, which
  immediately re-decoded the same still-visible QR and fired another
  check-in request. Two overlapping requests racing against the same
  stale token is what produced "Code expired → Checked in successfully
  → Code expired": whichever response landed last won the UI. Fix: stop
  the scanner on any terminal result, success or error, and start a
  genuinely new scan session on "Try Again" / "Scan Again" instead of
  letting the old one keep running underneath.
- **Member portal redesign** — login copy now matches the staff login's
  conventions ("Welcome back" / "Continue →"); check-in tab replaced
  the large floating scan button and surrounding dead space with a
  greeting, a compact check-in action, and live membership/balance
  stats; plan tab rebalanced so the days-remaining number no longer
  dominates the screen; receipts tab gained a heading/count/proper
  cards; header and bottom nav got a more premium treatment (logo
  badge, filled active-tab pill).
- **Landing page membership cards were rendering raw JSON as bullet
  text.** `plans.features` is written by the dashboard's Plan Settings
  as a JSON string (`{"featuresList":"a,b,c"}`, see `parsePlanData()` in
  `dashboard/helpers.js`), but `landing.js`'s `featureList()` treated
  that column as plain delimited text — splitting the JSON's own syntax
  into visible bullets (`{"featuresList":"Locker room` as one bullet).
  Fixed by unwrapping the JSON shape first, duplicating
  `parsePlanData()`'s logic locally rather than importing it, since
  `pages/dashboard -> pages/landing` is not an allowed import direction.
  Verified directly against the live `public_gym_plans` RPC.
- **Landing page Membership/Contact sections redesigned** — compact
  cards via one reusable `planCardHTML()` (still fully driven by
  `getPublicPlans()`, nothing hardcoded), capped visible features at 4
  with a "+N more" line, smaller CTAs, tighter section spacing
  throughout so the hero stays the dominant section. No Enquire button
  on the cards anymore, per an explicit follow-up request.

Verified before push: `npm run build`, `npm run lint` (same 12
pre-existing errors), full Playwright suite (37 passed / 21 skipped —
the skip count is credential-gated tests, unchanged), and
`node scripts/qa-responsive.mjs` (clean at every width 375–1600px on
`/` and `/login`).

---

## 2026-08-26: Batch 3 — dashboard UI/UX overhaul, member portal fixes,
audit report, real landing content + photos, invoice/mobile follow-ups

Pushed to `sculpt-whitelabel` (`fd76f98`). Run in phases (A–F, see the
per-phase status files below), then two follow-up fixes found only by
actually driving the live app with real owner credentials. Full detail,
including every migration applied and independently re-verified against
the live DB (not just the migration files), is in `STATUS-BATCH-3.md`,
`STATUS-PHASE-A-B.md`, `STATUS-PHASE-C.md`, `STATUS-PHASE-D.md` and
`STATUS-PHASE-EF.md` in the repo root — kept as the permanent record
rather than summarised away here.

- **Member photo persistence fixed** — `members.photo_url` never existed
  as a live column; uploads succeeded but the DB write silently failed.
  `126_member_photo_url_column.sql`.
- **Kiosk hold-to-exit rewritten** with Pointer Events + capture; fixed a
  latent bug where the hold ran 2.5s while the UI claimed 3s.
- **Backup/export filenames** are now `dsculpt-<type>-<date>` instead of
  all being the gym's name.
- **The dashboard's "Add Member" FAB was leaking into the member portal**
  (appended to `document.body`, never torn down on navigation) — fixed
  at the root, which also fixed it overlapping the member portal's
  Visits tab.
- **Full dashboard UI/UX pass**: mobile sidebar (scroll lock,
  Escape/back-close, populated the empty Support section), overview KPI
  period labels, All Members overflow menu + sticky header, member modal
  footer hierarchy (Renew/Invoice primary, Edit/Remind secondary,
  Cancel/Remove destructive), enquiries card rebuild, staff attendance
  loading/error states, alerts, finance.
- **Year-end report rebuilt into a "Financial & GST Audit Support
  Report"** — real computed report period, a "not a tax filing"
  disclaimer, 14 audit sections each with its own CSV export, honest
  "not recorded" states anywhere the schema genuinely has no such data
  (B2B/B2C split, SAC-wise, ITC, credit/debit notes) rather than
  fabricated rows. New `gyms.pan` / `legal_name` / `registered_address`
  columns (`127_gym_audit_identity_fields.sql`) feed a new Settings →
  GST & Tax → "Legal & Audit Identity" card.
- **Landing page**: real phone/WhatsApp/email/Instagram/address/hours
  (the `GYM` object in `landing.js`), a real lazy-loaded map, real
  footer links, real photos from `PHOTOS/` for hero/about + 2 of 4
  training slots (Personal Training and Group Classes are still stock —
  no source photo supplied for them), a 1200×630 social share image.
- **Three real bugs caught only by driving the live app with the real
  owner login Steven supplied mid-session** — none of these were visible
  from code review, build, lint, or the non-credentialed test suite:
  1. The new "Help & Support" modal invented a support email,
     `support@dsculptfitness.com` — no such mailbox exists. Fixed to the
     real, confirmed `dsculptfitness5@gmail.com`.
  2. The audit report's "Registered Address" silently fell back to
     `gyms.address`, which contains a typo'd email
     (`sculptfit@gmail.com`) in this gym's real data — printing it as the
     registered address on an audit document. Now only the dedicated
     `registered_address` column counts; unset renders "Not supplied",
     same as PAN.
  3. `checkin-kiosk-exit.spec.js` had a test bug (not a product bug): the
     kiosk's hold-to-exit fires at the 3-second mark itself, independent
     of `pointerup` — two tests dispatched a trailing `pointerup` into a
     kiosk that had already torn down and navigated away. Fixed the test
     helper; this also gave A3 its first genuine end-to-end pass (it
     could previously only skip without credentials).
- **A separate, unscheduled follow-up in the same session** (not part of
  the Batch 3 brief, done at the owner's direct request afterward):
  - Found and fixed a **build-breaking bug**: an unescaped backtick in
    `invoice-template.js`'s print-scaling comment was closing the file's
    template literal early, breaking every build with a syntax error.
    Caught immediately by `npm run build` failing outright.
  - Verified (by actually rendering, not reading CSS) an already-present
    invoice print-scaling fix and found it pushed a legitimate
    single-page invoice (GST + add-ons + discount + balance due) onto a
    spurious 2nd page. Measured real organic content heights per fixture
    rather than extrapolating linearly across zoom values (that
    extrapolation was itself wrong once tried — see the new CLAUDE.md
    convention on this) and retuned `zoom:1.18→1.12`,
    `min-height:990→950` in `invoice-template.js`'s `@media print` block.
  - Fixed the All Members page's mobile filter row rendering as ~145px
    boxes with the table several scrolls down, and the topbar title
    truncating to "All Me…" — see the new CLAUDE.md convention on the
    root cause (two stylesheets defining the same class at the same
    breakpoint) and `tests/members-mobile-filters.spec.js`.

**Verified before push:** `npm run build`, `npm run lint` (same 12
pre-existing errors, 0 new — checked after every commit), the full
credentialed Playwright suite with real owner credentials
(`SCULPT_TEST_EMAIL=sculptfit@gmail.com`, `--workers=1`) — 88 passed, 1
pre-existing failure (`security.spec.js:201`, needs a staff login — see
Pending), 6 skipped / 6 did-not-run (same staff-credential gap),
`node scripts/verify-schema.mjs`, `qa-responsive.mjs`, `qa-nav.mjs`, and
real browser screenshots (before/after, mobile and desktop) inspected by
hand, not just generated.

---

## 2026-08-27: QA pass 2 — driving P0/P1 flows live, four real bugs found and fixed

Follow-up to the 2026-08-26 Batch 3 session, run because that session's "no
other bugs found" claim for P0/P1 was verified mostly by reading code and by
direct `supabase.from()` probes rather than by actually driving the flows
end-to-end in a browser. This pass did that: real clicks, real submits, real
renders, on `npm run preview` with the owner login and the member portal
(`SC-0145-2PW` / `7917282929`). All test data used a `ZZTEST-` name prefix,
created and deleted by this session only, confirmed removed from the live DB
(and, where storage was involved, the storage bucket — see caveat below).

Four real bugs found, all fixed and re-verified live, none of them visible
from code review or the automated suite alone:

1. **Router race could silently turn the login screen back into the public
   landing page.** `src/app.js`'s `router.go()` computed `thisNavId` but only
   used it to guard clearing `_navigating` — the actual page render
   (`load().then(render)` inside `lazyRoute()`) ran unconditionally once its
   chunk import resolved, with no check that this navigation was still the
   current one. A stale/invalid session in `localStorage` at boot can fire
   Supabase's own async `SIGNED_OUT` event (which calls `router.go('landing')`)
   racing against `boot()`'s own auth check (which correctly calls
   `router.go('login')`) — whichever chunk import resolves *last* wins the
   DOM, regardless of which `router.go()` call happened last. Reproduced
   twice by seeding a garbage `sculpt-session` value and navigating to
   `/login`. Fixed by passing an `isStale()` check into `lazyRoute()`'s
   render step, keyed off `_navId`, so a superseded navigation's chunk
   import becomes a no-op once it resolves. Regression: none — a manual
   repro that reliably reproduced before the fix rendered the correct login
   form after it, twice.
2. **Member detail modal double-counted every add-on.** `members.plan_price`
   is written as the *combined* plan+add-ons total (see
   `sculpt_add_member`/`sculpt_renew_member` — the client always sends a
   single `p_plan_price` that already includes add-ons). `member-modals.js`'s
   `openMemberDetailModal()` read `m.plan_price` as if it were the base plan
   price alone and added `addonTotal` again on top — a member with a ₹2,500
   plan + a ₹300 add-on showed "Plan Price ₹2,800", "Net Total ₹3,100", and
   "Amount Paid" derived from the wrong Net Total, all wrong, while the
   actual DB row, payment history and invoice were all correct. Reproduced
   live by adding a `ZZTEST-` member with a plan + add-on + partial payment
   and comparing the modal against `payment_history`/`members` directly.
   `invoice-template.js` had the same latent bug in its own fallback path
   (only reachable if the plan has since been deleted from Plan Settings —
   its normal path looks up the live catalog price and was already
   correct). Fixed both to look up the current plan's base price first,
   falling back to `plan_price − addonTotal` (not `plan_price` itself) only
   if the plan no longer exists. Root cause: `plan_price`'s semantics
   (combined vs. base-alone) drifted between the write path and one read
   path, plus a not-yet-triggered fallback in a second read path — see
   CLAUDE.md for the "look up the live catalog price first" convention this
   established.
3. **A member could never be renewed again at the same plan+price after
   renewing while still active.** `sculpt_renew_member`'s "reject an
   exact-repeat renewal within 5 seconds" duplicate guard compared
   `now()` against `payment_history.paid_at` — but a renewal's `paid_at` is
   deliberately set to the renewal's *effective join date*
   (`toPaidAtTimestamp()`), which for a renew-while-active (the normal,
   encouraged case — renewing before expiry) is always in the future.
   `paid_at >= now() - interval '5 seconds'` is true for any future
   `paid_at`, forever — so the very next renewal attempt at the same
   plan+amount, even weeks later, was permanently rejected as a duplicate.
   This is not an edge case: it's the single most common renewal pattern
   (a repeat customer renewing the same plan every cycle). Found by
   actually renewing a `ZZTEST-` member twice — once while active, once
   after backdating its expiry — and hitting the block on a *second*,
   genuinely distinct renewal. Fixed in `128_fix_renew_duplicate_guard_future_paid_at.sql`
   — added `payment_history.created_at` (real insertion time,
   defaults to `now()`) and switched the guard to check that instead of
   `paid_at`. Re-verified live: the guard still correctly blocks a real
   double-click (two calls ~1s apart) and no longer blocks a legitimate
   renewal 32+ seconds after a prior one.
4. **Member portal's Check In tab showed "-5 days remaining" for an expired
   membership**, instead of "5 days ago" — `src/pages/member/index.js`'s
   Check In tab card rendered `${m.days_remaining} days remaining` with no
   sign handling, while the My Plan tab (`renderPlanTab()`) already had the
   correct `Math.abs(days)` + "ago"/"left" pattern for the same field. Same
   class of bug as #2: one call site correctly handled a value's full range,
   a second call site elsewhere didn't. Fixed both the Check In tab card and
   the post-scan confirmation screen (`showCheckinResult()`, same
   unguarded-negative pattern, lower risk since a genuinely expired member's
   scan is already rejected server-side before reaching that screen, but
   fixed for consistency). Reproduced live with a backdated-expiry
   `ZZTEST-` member logged into the member portal.

Also investigated and ruled out (real testing, not just reading code):

- **`member-portal-responsive.spec.js`'s occasional failure is a pre-existing
  test-infrastructure artifact, not a product race.** Ran the flagged test
  5× in isolation (5/5 pass) and 5× inside the full ~100-test suite at
  Playwright's default full parallelism (failed 1–3 times per run, but a
  *different* test each time, always the identical Playwright-level
  "Execution context was destroyed, most likely because of a navigation"
  error — never a product assertion failure). Isolating the same spec file
  alone at 4 workers (3 clean runs) ruled out contention between its own
  tests. Conclusion: CPU/resource contention from running many parallel
  Chromium instances on this dev machine, not a router or app-level race.
  No product fix applies; run the full suite at a lower worker count
  (`--workers=4` or so) for a reliable local pass, same as the credentialed
  suite already requires `--workers=1` for a different reason (auth rate
  limits).
- **`auth-flow.spec.js`'s "every dashboard section renders" test is
  independently flaky for a different, pre-existing reason**: it calls
  `window._navTo(...)` immediately after login without waiting for the
  dashboard chunk to finish its own initial render first (unlike the first
  test in the same file, which does wait for `#gym-content` to be
  non-empty) — a real race in the *test*, present since the file was
  written (single commit in its `git log`), not introduced by anything in
  this session. Out of this pass's scope to fix; flagging for whoever next
  touches that file.
- Re-audited every HTML-attribute interpolation site across `src/pages/`
  for the same class of gap as the 2026-08-26 XSS fix (`expenses-page.js`)
  — none found; that one site was isolated.

**Verified before calling this pass done:** `npm run build`, `npm run lint`
(same 12 pre-existing errors, 0 new), `npx playwright test --workers=1` with
real owner credentials (91 passed, 1 pre-existing failure —
`security.spec.js:201`, needs a staff login, same as every prior batch — 6
skipped/6 did-not-run for the same reason), `node scripts/qa-responsive.mjs`
/ `qa-nav.mjs` / `qa-dashboard.mjs` (all clean at all 8 widths).

**One known cleanup gap:** one test invoice PDF (`ZZTEST-Rajasekaran…`, no
real data) uploaded to the `invoices` storage bucket during the html2canvas→
WhatsApp path test could not be removed — `npx supabase storage rm` (with
`--experimental`) accepted the command but reported `"deleted":[]` for a
file `ls` confirms exists, on both the single-file and recursive-folder
forms. Not a security issue (private bucket, synthetic test content, no real
member's data), but the CLI issue itself is unresolved — whoever has
dashboard storage-browser access should delete
`invoices/7854b083-ce56-47ff-8339-79ebbd183fd5/65ede752-9fdf-421d-bc4f-0e5068e95bd9/`
by hand. The member row itself and its payment history were deleted via SQL
and confirmed gone.

---

## Pending

Genuinely open items, as of 2026-08-26:

- **`security.spec.js:201`** ("a token older than 90 seconds... is
  rejected") still needs a real staff login to pass — it currently
  returns `NOT_STAFF` when run with owner-only credentials.
- **`tests/checkin.spec.js`, `tests/security.spec.js`'s other check-in
  tests, `tests/staff-login-management.spec.js`'s third test** — need
  `SCULPT_STAFF_EMAIL`/`SCULPT_STAFF_PASSWORD` to run at all; currently
  skipped/did-not-run whenever only owner credentials are provided. This
  is the single remaining thing standing between the credentialed suite
  and fully green — see `STATUS-BATCH-3.md`'s "How to get this pushed"
  for the two ways to clear it.
- **`manoj.sculpt@gmail.com` password unknown** — reset it through the
  app (Staff page → this row → Manage Login → Reset Password) when
  someone needs a real staff login for the item above.
- **Settings → General → Address currently contains `sculptfit@gmail.com`**
  — an email, not a street address. Pre-existing data-entry error, not
  a code bug, but live and customer-facing: it's what prints on member
  invoices today, and it's what an unfixed audit-report bug used to
  silently fall back to as "Registered Address" before this session's
  fix (see the 2026-08-26 entry above). Fix directly in Settings.
- **The GSTIN on file, `22AARGAR4763132`, doesn't match the standard
  15-character GSTIN pattern** (2-digit state code + 10-char PAN + entity
  code + 'Z' + checksum). Nothing has touched or "corrected" it — that
  would be inventing a value — but it feeds the audit report's GST
  sections. Worth checking against the actual GST registration
  certificate.
- **Settings → GST & Tax → "Legal & Audit Identity" is empty** — Legal
  Name, PAN and Registered Address all show "Not supplied" on the audit
  report until Steven fills them in.
- **`npx supabase db push` is broken for this project.**
  `supabase migration list` shows the remote's tracked migration history
  has diverged from local files starting at migration `102` — every
  migration `102`–`127` shows `remote: ""` even though their schema
  changes are demonstrably live. Predates this session; not introduced
  or fixed by it (repairing `supabase_migrations.schema_migrations` is a
  separate, riskier job). Migrations `126` and `127` were both applied
  directly via `npx supabase db query --linked` and independently
  re-verified against live `information_schema.columns` instead of
  `db push`. Future migrations will hit the same wall until this is
  repaired — plan for the manual-apply workaround, not `db push`.
- **Two of the six landing-page photo slots** (Personal Training, Group
  Classes) still use the original stock images — `PHOTOS/` only had 4
  real photos, not the 6 needed to fill hero/about/train-1..4.
- **`scripts/verify-schema.mjs`'s RPC section is unreliable.** Supabase
  now returns `401 Invalid API key — Only service_role can be used for
  this endpoint` on `/rest/v1/` (the OpenAPI spec endpoint the script
  fetches to list exposed RPCs) when called with the anon key — a
  platform-side change, unrelated to anything in this repo. The
  table-existence and removed-features sections are unaffected (they
  hit `/rest/v1/<table>` directly, which anon keys can still read) and
  stay trustworthy; the `MISSING`/`all exposed rpcs:` output under "RPCs
  exposed" should be ignored until the script is rewritten to check
  function existence a different way (e.g. `pg_proc` via a
  `service_role`-authenticated call, or the Supabase CLI's
  `db query --linked`).

---

## 5. What the client still owes

Updated 2026-08-26 — most of this list is now resolved by Batch 3's
Phase E/F (see that dated entry above). Nothing was invented to close
any of it — no fake address, no made-up class times, no fictional
trainers, no invented member counts, and no placeholder phone number
dressed up as a real `tel:` link. What's still genuinely open:

**All of these live in one place:** the `GYM` object at the top of
`src/pages/landing.js`. An empty string means "not supplied" and renders
the chip; a filled-in value renders the real link and the chip
disappears — every one of these is now filled in.

- [x] Street address — No.13, 20th Cross, Malagala, Nagarbhavi 2nd
      Stage, Bangalore - 560091
- [x] Phone number — +91 78921 31996 and +91 88678 78946
- [x] WhatsApp number — +91 88678 78946
- [x] Email address — dsculptfitness5@gmail.com
- [x] Weekday opening hours — Mon–Sat 5:00 AM – 10:00 PM
- [x] Weekend opening hours — Sunday 7:00 AM – 12:00 PM
- [x] Google Maps link — wired to the real coordinates, embedded as a
      lazy-loaded map in the Contact section
- [x] Instagram / social link — wired in the footer
- [ ] Confirm the four programmes (Strength & Conditioning, Personal
      Training, Group Classes, Cardio & Conditioning) still match what
      the gym actually offers — never explicitly re-confirmed with
      Steven, just carried forward.

**Photography.** Real D Sculpt photos have replaced the Figma-derived
stock images for 4 of 6 slots — see `scripts/prep-landing-images.mjs`,
now reading from `PHOTOS/` instead of the old reference.

- [x] Licence concern resolved — the hero, about, and 2 of the 4 training
      photos are D Sculpt's own, sourced from `PHOTOS/`.
- [ ] **2 training slots still stock** (Personal Training, Group
      Classes) — `PHOTOS/` only ever had 4 real photos (main + 3 sub),
      not the 6 needed for hero/about/train-1..4. Drop 2 more training
      photos into `PHOTOS/` and re-run the prep script to finish this.

**Migration 102 — resolved.** `102_public_plans_showcase.sql` is applied
and live (`gyms.public_plans_enabled = true`, `public_gym_plans()`
exists) — the Membership section on the live site shows real plan
pricing from Plan Settings.

**Also outstanding, elsewhere:**

- [ ] **The domain.** `index.html` has no `canonical`, `og:url` or
      `og:image` tag (`og:image` itself is now wired, pointing at the new
      1200×630 social share image generated from the hero + logo —
      `canonical`/`og:url` alone are deliberately still absent). That is
      deliberate — a wrong canonical URL harms search ranking more than
      having none. Add `canonical`/`og:url` once the domain exists.
- [x] **Address in structured data** — `index.html`'s JSON-LD now carries
      the real address, phone, geo coordinates and opening hours.
- [x] **A social share image** (1200×630) — generated from the hero +
      logo, wired to `og:image`.
- [x] **Owner name** — set in Gym Settings (`gyms.owner_name`).

---

## 6. Things that will break it

These are hard-won. Each one caused a real outage in the product this was
built from.

- **`vite.config.js` must keep `base: '/'`.** With `'./'`, refreshing a
  deep page like `/dashboard/finance` silently serves the HTML file as
  JavaScript and the page goes blank — with no error anywhere. This was
  live for months before anyone found it. A test guards it now.
- **Money operations are deliberately atomic.** `sculpt_add_member`,
  `sculpt_renew_member` and `sculpt_clear_balance` each do their work in a
  single database transaction, and they deliberately run with the caller's
  own permissions. Do not "tidy" them into separate steps: on a weak
  connection the membership would move forward while the payment vanished,
  and nothing in the app could detect it afterwards.
- **`.topbar` has `overflow: hidden`.** Any dropdown or popup anchored in
  the top bar must be attached to `<body>`, or it gets clipped.
- **Never use the `hidden` attribute on something you also styled with
  `display:`.** The element stays visible and every close button silently
  stops working. Use a `.is-open` class.
- **No full-screen overlays on desktop.** Even an invisible one swallows
  the first click on the sidebar and table rows. Mobile only. The landing
  page's intro fade is the one exception, and it obeys the same rule: the
  plate is **removed from the DOM** when the fade ends, not just faded to
  transparent. If you ever change that animation, keep the `.remove()`.
- **Deleting hides, it does not erase** (`is_active = false`) — except
  expenses, which really are deleted. Do not "fix" that difference.
- **Any text a user typed must go through `escHtml()`** before being put on
  the page, or the app can be attacked through a member's name.
- **Pages and the PDF engine load on demand.** The PDF engine is ~935 kB
  and must only download when someone actually makes a PDF. A test guards
  this too.
- **The desk check-in tablet loses its QR rotation the instant it goes
  offline** — `checkin-display.js` shows a visible "Offline" banner
  rather than letting a stale (and by then guessable) code sit on
  screen. Staff fall back to checking a member in from the members
  list while the tablet is down.
- **A member must never get a row in `gym_users`.** That table is what
  `get_my_gym_id()` reads, and a member appearing in it inherits
  gym-wide read access to the entire business — every other member's
  phone, Aadhaar photo and payment history.
- **Never add a member SELECT policy on `gyms`.** That table holds
  `owner_password` in plaintext (migration 022, kept per client
  agreement). The member portal reads gym name/logo through a narrow
  `SECURITY DEFINER` function instead, the same pattern as
  `public_gym_plans()` in migration 102.
- **Check-in RPCs (`sculpt_staff_checkin`, `sculpt_member_checkin`,
  `sculpt_manual_checkin`) must RETURN a status, never RAISE.** A raised
  exception rolls back the transaction and takes the denied-attempt row
  with it — see `CLAUDE.md`'s "Conventions" section for the full
  rationale.
- **UPDATE 2026-08-27: the kiosk exit is now a plain single-tap "← Back"
  button** (`src/pages/dashboard/checkin-display.js`) — the 3-second hold
  described just below was removed at the client's explicit direction
  after it failed live during a demo (root cause: `window._navTo?.()`
  silently no-oping — see the `_navTo` entry lower in this section — not
  the hold gesture itself, but the client's decision to drop the hold
  stands regardless). **The kiosk is now only as safe as physical
  supervision of the tablet** — anyone who walks up to it while it's
  running can tap Back and land on an account that can see every
  member's phone number, Aadhaar photo, and can collect payments. This
  was flagged, not silently implemented: two mitigations were proposed
  and are still open, unimplemented —
  1. a 4-digit staff PIN required on exit, or
  2. auto-return to the kiosk screen after N seconds of inactivity on
     the dashboard.
  Neither is built. If this tablet sits somewhere genuinely unsupervised,
  raise this with the owner before treating the kiosk as safe.
  `.checkin-kiosk-active` (hiding the real sidebar/topbar, `dashboard.css`)
  is untouched and still matters — it stops the mobile swipe-open sidebar
  gesture from sliding the real dashboard nav out from underneath the
  full-screen overlay.
  <details><summary>Original hold-to-exit rationale (historical, no longer implemented)</summary>

  The kiosk display's exit used to require a 3-second hold, not a tap,
  specifically because the tablet sits unattended in a public area,
  signed into an account that can see member phone numbers, Aadhaar
  photos and collect payments. Kept here so the reasoning isn't lost —
  see the UPDATE above for the current, weaker state and what would
  restore an equivalent gate.
  </details>
- **`window._navTo` (and anything else in `app.js`'s `LEGACY_GLOBALS`
  that's assigned at a module's top level instead of inside its render
  function) only gets set on that module's FIRST import.** `router.go()`
  deletes every `LEGACY_GLOBALS` entry on every navigation, but a dynamic
  `import()` of an already-loaded module doesn't re-run its top-level
  code — so leaving the dashboard once and coming back left
  `window._navTo` permanently `undefined` for the rest of the session.
  This is exactly what broke the kiosk's exit button above. Fixed by
  having `dashboard/index.js`'s `renderGymDashboard()` re-assign
  `window._navTo = nav` on every render, not just relying on the
  module-top-level assignment. `checkin-display.js` no longer depends on
  the global at all — it imports `nav` directly. If you add a new inline
  `onclick="window._navTo(...)"` (or add another global to
  `LEGACY_GLOBALS`), assign it inside the render function that creates
  that markup, not at module top level, or it will silently die the same
  way after the first re-entry.
- **The member login has no password, PIN or OTP.** Application number +
  phone number, verified entirely inside the `member-signin` Edge
  Function, is the whole security boundary. It rate-limits by IP and by
  application number, and returns the identical error whether the number
  or the phone was wrong — never make those two cases distinguishable
  from the response, or the endpoint becomes a tool for enumerating
  valid application numbers.
- **`supabase/functions/member-signin` must never actually send email.**
  It uses `admin.generateLink()` + `verifyOtp()` specifically because
  that path only returns link data — `signInWithOtp`,
  `inviteUserByEmail` and `resetPasswordForEmail` all dispatch real mail
  to the synthetic `member-<uuid>@members.internal` address, which
  doesn't exist and would bounce.
- **Application numbers are never typed, only generated**
  (`sculpt_generate_application_number`, format `SC-####-XXX`). The
  regenerate action in the edit-member modal is deliberate and rare —
  it immediately invalidates the old number, so anyone still holding
  the previous WhatsApp message is locked out until sent a new one.
- **The landing page's `popstate` listener must check `page ===
  router.current` before re-rendering.** Chromium fires `popstate` — not
  just `hashchange` — when a visitor clicks a same-page anchor link like
  `<a href="#why">`, even though the route hasn't actually changed.
  `router.go()` has no "already on this page" early-out, so without that
  guard, clicking any landing-page nav link (Why us, Training, Membership,
  About, Contact) tore the whole page down and rebuilt it — replaying the
  intro logo animation on every single menu click instead of just letting
  the browser scroll to the section. See the guard at the top of the
  `popstate` handler in `src/app.js`.
- **A feature that adds a new `gym_users.role` value must also widen the
  `gym_users_role_check` constraint that gates it.** `001_initial_schema.sql`
  defines `role TEXT NOT NULL CHECK (role IN ('owner', 'admin'))`.
  `030_staff_login_tiers.sql` built the entire staff-login feature around
  `role = 'staff'` — `get_my_gym_id_as_staff()` queries for it,
  `supabase/functions/create-staff-user` inserts it — but never widened the
  constraint. Every attempt to create a staff login failed at the
  `gym_users` insert with `violates check constraint
  "gym_users_role_check"`, silently, because nobody had ever tried to
  create one until this was caught. `113_widen_gym_users_role_check.sql`
  fixes it. The general rule: adding a role/status/enum value to code that
  reads or writes a column is only half the change — grep for the CHECK
  constraint on that column and widen it in the same migration, not a
  later one.
- **Two stylesheets must never redeclare the same class at the same
  media breakpoint.** `components.css` (static import from `app.js`,
  always loads first) and `dashboard.css` (lazy import from
  `dashboard/index.js`, so it always loads second, once the dashboard
  route mounts) both had a `@media(max-width:768px){ .members-filters{…} }`
  rule. Same specificity, dashboard.css later in the cascade, so it
  silently won and threw away components.css's correct 2-up grid —
  `display:flex;flex-direction:column` with no children reset meant
  every child's `flex:1 1 130px` (authored for a row, where flex-basis
  means width) got reinterpreted along the now-vertical main axis
  instead, producing ~145px-tall filter boxes with `flex-grow:1`
  stretching them further. The rule was individually correct in each
  file; the bug was two files owning the same selector at the same
  breakpoint at all. Grep both `components.css` and `dashboard.css` for
  a class before adding a mobile override to it in either.
- **`zoom` on the invoice sheet changes what `getBoundingClientRect()`
  reports, non-linearly across different zoom values.** Scaling
  `invoice-template.js`'s `.page` down from `zoom:1.18` to `1.12` to fix
  a spurious page break, a naive `renderedHeight / 1.18 * 1.12` predicted
  1108.6px for the worst-case fixture; the real rendered height came out
  17px higher, because `min-height:990px` (chosen by scaling down from
  the old `940`) landed only 2px under that same fixture's true organic
  content height, and zoom's own sub-pixel rounding made which one "won"
  unpredictable. Fixed by measuring true organic content height directly
  (zoom and min-height both forced to `0`/`1` via inline style overrides)
  for every fixture, then picking a `min-height` with real margin below
  the tallest single-page fixture, not a value derived by scaling one
  known-good number. See `tests/invoice-print.spec.js` and the comment
  above `@media print{ .page{…} }` for the actual measured numbers.

### PowerShell notes (your terminal)

- `curl` is not real curl. Use `curl.exe`, and add `--ssl-no-revoke` on
  your university network.
- `&&` chaining and `$(...)` are bash syntax and will not work.
- **`npx vercel login` (and any Vercel CLI command) fails with
  `TypeError: fetch failed` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` on a
  machine running Kaspersky** (or another antivirus that scans HTTPS
  traffic). Node doesn't trust the antivirus's re-signed certificate by
  default. Fix: `$env:NODE_OPTIONS="--use-system-ca"` in the terminal
  before running any `vercel` command — that tells Node to use Windows'
  own certificate store, which does trust it.

---

## 7. What was removed, and why

If you ever wonder where something went:

| Removed | Why |
|---|---|
| Superadmin panel | Managed many gyms from one login. You have one gym. |
| WhatsApp bulk broadcast | Paid feature; you send reminders manually. |
| Razorpay | Existed only to sell broadcast credits. |
| Automatic reminders | You send them by hand from Member Alerts. |
| Contact Us form | You wanted phone/WhatsApp, not a ticket queue. |
| Pro/Core plan tiers | You get everything; there is no plan to upgrade to. |
| Subscription billing page | Billed the gym for its software plan. No vendor now. |
| Certificate verification page | Belonged to the previous product entirely, and contained a real person's private details. |

**Kept deliberately:** the owner/staff split. Staff still cannot see
Finance, Settings, Backup or staff management. That is real access
control, not a sales tier.

---

## 8. Known limitations

Stated plainly rather than hidden:

- **The database is in Seoul, not Mumbai.** Roughly 100ms slower per
  request for Indian users. Fine in practice — the previous product ran
  eight Indian gyms this way — but Mumbai would be faster. Changing it
  means creating a new project and moving the data.
- **13 ESLint warnings** about unused variables. All pre-existing, all
  cosmetic, none affect behaviour.
- **Two animation warnings** about animating `width` on the sidebar
  collapse. The sidebar animates its width while the content area animates
  its left margin in lockstep; converting to `transform` would break the
  layout that pairing exists to maintain. Left on purpose.
- **Web Push is not enabled.** The code exists but the functions are not
  deployed and no keys are set. In-app notifications work fine.
- **Old migration files still mention the previous product's name** in SQL
  comments and function names like `is_flym_admin`. Those files are the
  record of what already ran; rewriting them would make them lie. The live
  database uses `sculpt_*` names, and nothing user-facing shows the old
  name.

---

## 9. Where things are

```
src/app.js                        routing
src/lib/                          database access
  members.js                      members, payments, revenue (the money code)
  auth.js                         login and profile loading
  permissions.js                  who can see what (owner vs staff)
  invoice-pdf.js                  renders the invoice to a PDF blob
  checkin.js                      rotating-token issue, staff/member check-in RPC wrappers,
                                     attendance log + follow-up queries, realtime subscribe
  qr.js                           lazy QR encode/decode — never statically imported
  member-auth.js                  member sign-in (Edge Function call), portal data readers
src/pages/landing.js              the public website  <- placeholders live here
src/pages/login.js                login screen (owner/staff)
src/pages/member/                 the member portal — a second, much smaller app
  login.js                        application number + phone, no password
  index.js                        portal shell: Check In / My Plan / My Receipts / My Visits
  receipts.js                     payment history + any already-generated PDFs
src/pages/dashboard/              the app itself, one file per section
  invoice-template.js             the invoice/receipt HTML — shared by the preview, print and PDF paths
  checkin-display.js              full-screen desk kiosk QR screen (← Back to exit, no PIN — see §6)
  checkin-scan.js                 staff/trainer in-app camera scan
  checkins.js                     Check-ins section: attendance log + not-seen-recently list
supabase/functions/
  member-signin/index.ts          the entire member auth security boundary — see CLAUDE.md
src/styles/tokens.css             all colours, fonts and spacing
scripts/generate-icons.mjs        rebuilds app icons from sculp-logo.png
scripts/verify-schema.mjs         checks the database matches the code
supabase/migrations/              database history, applied in filename order
tests/                            automated checks
vercel.json                       Vercel build + SPA routing config (see §3)
```

**Fonts:** Barlow Condensed for big website headlines, Manrope everywhere
else. Set in `src/styles/tokens.css`.

**Icons:** regenerate with `node scripts/generate-icons.mjs` if the logo
changes. Sizes 96px and below use a cropped version of the emblem, because
the full badge is unreadable that small.
