# FINAL PRODUCTION QA + BUG-FIX PASS — D Sculpt Fitness

## Read first (do not skip, do not summarise back to me)
`CLAUDE.md`, then `HANDOVER.md` §4, §6, §8, "Pending", then `STATUS-BATCH-3.md`
("PENDING / NOT DONE", "NEEDS STEVEN", "CHECKS") and `TESTING-BATCH-3.md`.

Those files already contain the architecture rules, the invariants that have
caused real outages, and the list of known non-issues. Treat them as binding.
Do not restate them to me and do not re-derive them — apply them.

Rules that follow from them, restated only because breaking them is fatal:
never reintroduce multi-tenancy/superadmin; members never get `gym_users` rows
or a `gyms` SELECT policy; money stays in atomic Postgres functions; check-in
RPCs return status, never RAISE; the scanner stops on *every* terminal result;
`escHtml()` on all user text; `base: '/'`; lazy loading and invoice width/CSS
scoping intact; kiosk exit stays a 3-second hold.

## Credentials
Owner: `SCULPT_TEST_EMAIL` / `SCULPT_TEST_PASSWORD` (I will supply in the
terminal, not in this file). Run credentialed tests with `--workers=1` — parallel
sign-ins hit Supabase's auth rate limit and fail like product bugs.
There is still **no staff-role login**; anything staff-gated is blocked, not
broken. Do not fabricate a workaround. Never print secrets or the service_role key.

## Database access — you have it, use it
The project is linked to the Supabase CLI (`npx supabase login` is already done
on this machine). Do **not** hand me SQL to paste into the dashboard. Query and
verify the live database yourself:
```
npx supabase db query --linked "select ..."     # read anything, freely
```
Use it to check RLS policies, function bodies (`pg_get_functiondef`), constraints,
and real row data — and to test RPCs end-to-end instead of only reading the SQL
file. Verify every schema claim against live `information_schema`, not against
what a migration file says it did.

Writes: `npx supabase db push` is broken for this project (remote migration
history diverged at `102` — see HANDOVER "Pending"). So any schema change is a
new zero-padded migration file in `supabase/migrations/` **and** applied with
`db query --linked`, then re-verified live. Never rewrite existing migration
files — they are the record of what already ran. Tell me each migration you
applied. Destructive statements (DROP, DELETE, TRUNCATE, ALTER that loses data)
on live data: ask me first.

## Step 0 — baseline before touching anything
```
npm run build
npm run lint
npx playwright test                 # expect ~60 pass / 28 skip uncredentialed
node scripts/verify-schema.mjs      # its "RPCs exposed" section is known-broken; ignore
```
Record the starting state. Known baseline: 12 pre-existing ESLint no-unused-vars
errors, `security.spec.js:201` fails without a staff login. Anything worse than
that baseline at the end is a regression you caused.

## Method
For each area below: read the code → reproduce against the running app
(`npm run preview` + Playwright/browser, real clicks, real RPCs) → root-cause →
smallest correct fix → regression test → re-run that test plus the suite.

- Reproduce before fixing. No speculative fixes, no symptom patches.
- If the same bug keeps returning, fix the architecture, not another conditional.
- If a test is wrong, say so and fix the test. If the product is wrong, fix the
  product. Never edit a test just to make it green.
- If a fix needs an architecture change, missing credentials, or client data:
  stop that item and report it. Don't guess.
- Skipped ≠ passed. For every skipped test, say why and what stays unverified.

## Scope, in priority order

**P0 — security, money, identity.** Member data isolation via
`get_my_member_id()` (try to read another member's phone/Aadhaar/payments/
receipts/visits by tampering with client args and direct RPC calls); RLS on
members, payments, gyms, gym_users; `get_my_gym_id_as_staff()` honouring
`is_active` + `login_enabled`; member-signin rate limiting and identical error
for wrong number vs wrong phone (enumeration oracle); application-number
generation/uniqueness/regeneration; QR token expiry + replay + reuse;
XSS/HTML injection through member names, plan names and plan features;
service-role/env/secret exposure; Edge Function authorization.
Money: add member, renew (expired / active / same-day / after expiry / with
existing balance), partial payment, balance due, clear balance, discounts
(incl. discount > price, negative, zero-price plan, huge and decimal amounts) —
verify amounts agree across member record, payment history, receipt and invoice.

**P1 — core journeys.** Owner login/staff login/session persistence/refresh/
deep-route access/logout; staff permission restrictions (finance, settings,
backup, staff management) and immediate revocation on disable/remove; member
login (right, wrong number, wrong phone, both wrong, rate limit, refresh,
direct route access); member portal as its own app — Check In, My Plan,
Receipts, Visits — across active/expired membership, balance/zero balance,
empty and populated states, with loading and error states present;
QR check-in end to end (kiosk rotation, offline banner, 3s hold-to-exit,
member scan: valid/expired/invalid/network error/camera denied/repeat scans —
one physical scan must never produce "expired → success → expired", and no
duplicate or overlapping requests); invoice/PDF across all three consumers
(preview, browser print, html2canvas→WhatsApp) — 660px/933px budget, GST,
add-ons, long names, multi-page, no dashboard CSS pollution; landing page
plan rendering from Plan Settings (`plans.features` JSON must never render raw)
and same-page anchors that must not rebuild the page or replay the intro.

**P2 — UI/UX.** Responsive at 1600/1440/1280/1024/768/480/390/375 on every
major route (`node scripts/qa-responsive.mjs`, `node scripts/qa-nav.mjs`, and
`node scripts/qa-dashboard.mjs` if I've given credentials): horizontal overflow,
clipping, overlap, offscreen buttons, modal/table/bottom-nav issues, touch
targets. Accessibility: keyboard nav, focus visibility, labels, modal focus and
Escape, contrast, accessible names — but do not redesign a component to satisfy
a generic a11y rule where it conflicts with the documented architecture.
Empty/loading/error states. Performance only where measurable: duplicate
Supabase calls, duplicate listeners, leaked scanner sessions, PDF engine
loading when it shouldn't, service-worker staleness.

**Static audit, throughout.** Broken/circular imports and wrong import
direction (`pages/ → lib/` only), missing awaits, race conditions, stale `S`
state, duplicate listeners, scanner lifecycle, timezone handling (gym timezone,
never UTC), `RETURNS TABLE` column shadowing in plpgsql, and any migration that
`CREATE OR REPLACE`s a function body copied from an older version.

**Hostile exploratory pass.** Rapid/double clicks, back/forward, refresh mid-load,
duplicate submits, offline↔online, slow network, camera denied mid-scan, expired
and stale sessions, empty database states, very long/unicode/script-payload input.

## Do not report as bugs
Everything under CLAUDE.md "Known non-issues", HANDOVER.md §8, and the
"Known — do not report these" list in `TESTING-BATCH-3.md`. Also already known
and not yours to solve: broken `supabase db push` (see above),
`verify-schema.mjs` RPC section, missing staff test login, two stock landing
photos, Settings address/GSTIN/PAN data-entry gaps.

## Stop conditions
Work top-down by priority. Do not spend the session on P2/P3 while P0/P1 items
are open. Do not stop after the first few bugs — complete the P0 and P1 sweep.
Do not declare the app ready because build/lint/Playwright are green; ready means
the P0 and P1 journeys above were actually exercised and pass.

## Final report (keep it short and concrete)
1. Counts: tests run / passed / failed / skipped, vs. the Step 0 baseline.
2. Bugs found → fixed → remaining, each with severity, file:line, one-line repro,
   root cause, and for unfixed ones what is blocking it.
3. What could not be tested and why.
4. Regression risk from your own changes.
No generic QA advice, no restatement of the docs, no summary of what you read.
