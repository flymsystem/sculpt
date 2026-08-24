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
| Gym code | `SCULPT01` |

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

## Pending

Genuinely open items, as of 2026-08-23:

- **Gym display name.** `gyms.name` is currently `"D fitness"`, which is
  why `tests/auth-flow.spec.js` (expects `"D Sculpt Fitness"`) fails —
  that's a stale test expectation vs. real data, not a code bug. The
  owner confirmed the correct name in session on 2026-08-24, and
  `supabase/migrations/125_fix_gym_display_name.sql` is written and
  committed — **not yet applied**, since this environment only has the
  anon key, not the database password. Run it via the Supabase SQL
  editor or `npx supabase db push` to fix the name everywhere it's
  surfaced (member portal header, member login, `auth-flow.spec.js`).
- **`manoj.sculpt@gmail.com` password unknown** — see above; reset it
  through the app when someone needs to actually test as that account.
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
- **`security.spec.js:201`** ("a token older than 90 seconds... is
  rejected") still needs a real staff login to pass — it currently
  returns `NOT_STAFF` when run with owner-only credentials. Same root
  cause as the `checkin.spec.js` note above.
- **tests/checkin.spec.js, tests/security.spec.js's other check-in
  tests** — need `SCULPT_STAFF_EMAIL`/`SCULPT_STAFF_PASSWORD` to run at
  all; currently skipped whenever only owner credentials are provided.

---

## 5. What the client still owes

Everything below renders as a muted "to be supplied" chip on the live
site. Nothing was invented — no fake address, no made-up class times, no
fictional trainers, no invented member counts, and no placeholder phone
number dressed up as a real `tel:` link.

**All of these live in one place:** the `GYM` object at the top of
`src/pages/landing.js`. Replace the values and rebuild. An empty string
means "not supplied" and renders the chip; a filled-in value renders the
real link and the chip disappears.

- [x] Street address — Malagala, Bangalore
- [ ] Phone number
- [ ] WhatsApp number
- [ ] Email address
- [ ] Weekday opening hours
- [ ] Weekend opening hours
- [ ] Google Maps link
- [ ] Instagram / social link
- [ ] Confirm the four programmes match what the gym actually offers

**Photography.** The landing page currently ships stock gym photography
extracted from the Figma reference in `reference/`, regenerated into
`public/img/` by `scripts/prep-landing-images.mjs`. Two consequences:

- [ ] **Check the licence before going live.** These came from a Figma
      community template; they are not D Sculpt's own photographs.
- [ ] **Replace with real D Sculpt photos** when they exist. Drop them in
      as `public/img/hero.jpg`, `about.jpg` and `train-1…4.jpg` and
      nothing else needs to change. Every interior shot is rendered
      black-and-blue duotone in CSS (`.sc-duo`), which is what removes the
      original gym's yellow branding — real photos will pick up the same
      treatment automatically. The hero is deliberately full colour.

**One migration still needs running.**

`supabase/migrations/102_public_plans_showcase.sql` makes the landing
page's Membership section show the plans you configure under Plan
Settings, so pricing lives in one place instead of two. It is additive
and safe to run more than once.

- [ ] Run it in the Supabase SQL editor (paste the file, execute).

Until it runs, the Membership section simply does not appear — the page
logs one console warning and carries on. Nothing else depends on it. If
you would rather not publish pricing publicly, set
`gyms.public_plans_enabled = false` and the section stays hidden.

**Also outstanding, elsewhere:**

- [ ] **The domain.** `index.html` has no `canonical`, `og:url` or
      `og:image` tag. That is deliberate — a wrong canonical URL harms
      search ranking more than having none. Add them once the domain
      exists (there is a comment in `index.html` marking the spot).
- [ ] **Address in structured data.** `index.html`'s JSON-LD omits
      `address`, `telephone` and opening hours rather than stubbing them.
      Publishing invented location data to Google is worse than none.
- [ ] **A social share image** (1200×630) for link previews.
- [ ] **Owner name** — the gym record says `[PLACEHOLDER: owner name]`.
      Fix in the app under Gym Settings.

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
- **The kiosk display's exit requires a 3-second hold, not a tap**, and
  hides the real sidebar/topbar entirely (`.checkin-kiosk-active` in
  `dashboard.css`) rather than just visually covering them — the tablet
  it runs on sits unattended in a public area, signed into an account
  that can see member phone numbers, Aadhaar photos and collect
  payments. Don't turn that back into a single-tap Exit button.
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
  checkin-display.js              full-screen desk kiosk QR screen (hold-to-exit)
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
