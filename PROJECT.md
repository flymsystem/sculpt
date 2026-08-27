# D Sculpt Fitness — Project Reference

A complete, from-scratch reference to what this codebase is, everything it's
built from, and how it's put together. This is a reference document, not a
changelog — for the history of how individual decisions were reached, see
migration file headers and commit history. For AI-agent behavioral rules and
hard-won "don't do this" warnings, see `CLAUDE.md` — this file complements it
rather than repeating it.

---

## 1. What this is

**D Sculpt Fitness** is a single-gym management application plus its public
marketing website, for one real gym in Bangalore. It replaces spreadsheets
and manual attendance with: a member database with payments/invoicing, an
owner/staff dashboard, a QR-code check-in system, and a member-facing portal
(no email, no password — application number + phone number only). It's
installable as a Progressive Web App on a phone.

**Current state (as of 2026-08-27):** pre-launch. The gym has zero real
members in production yet; all member data seen in the database up to this
point has been test/demo data, deliberately purged. The app itself is fully
built and deployed — this is a "clean database, real software" state, not an
unfinished build.

**Single-tenant by design.** This app used to be multi-gym software
(superadmin panel, plan tiers, subscription billing). All of that was
deliberately removed — see §8 "What was removed, and why." There is
**exactly one gym**, and that assumption is load-bearing throughout the
codebase (member login resolves "the" gym server-side rather than trusting a
client-supplied identifier, for example). Reintroducing multi-tenancy would
require deliberately unwinding this assumption everywhere it appears, not
just adding a `gym_id` parameter somewhere.

---

## 2. Complete tech stack

### Frontend
- **Plain JavaScript (ES modules), no framework** — no React, Vue, or
  similar. This is a deliberate choice, not an oversight: pages are built as
  functions that produce HTML strings and wire up event listeners directly
  (see `src/pages/dashboard/*.js`). The tradeoff is explicit — more manual
  DOM wiring, but zero framework runtime overhead, zero framework version
  churn, and a very small, auditable dependency surface for an app that
  handles government ID photos and payment data.
- **Vite** (`^8.0.13`) — dev server, bundler, and code-splitting. `vite.config.js`
  keeps `base: '/'` (never `'./'` — see §5) and defines a `manualChunks`
  bucket for QR code so it never lands in the main bundle.
- **Vanilla CSS** — no Tailwind, no CSS-in-JS. `src/styles/tokens.css` is
  the single source of truth for every colour, font, and spacing value.
  `src/styles/global.css`, `components.css`, `dashboard.css`, and
  `mobile-fixes.css` layer on top, loaded in a specific static-then-lazy
  order that matters (see CLAUDE.md's stylesheet-collision warning).
- **PWA** — installable, with a service worker (cache-busted per build via
  a stamped version string) and app icons regenerated from a source logo.

### Backend — Supabase (Postgres + Auth + RLS + Edge Functions + Storage)
- **Postgres** — the entire data model, 67 migration files deep, numbered
  up to 130 with intentional gaps (see §4).
- **Row-Level Security (RLS)** — the actual access-control mechanism, not
  application-layer checks. Three security domains: owner, staff, member —
  each gated through its own resolver function (`get_my_gym_id()` for
  owner, `get_my_gym_id_as_staff()` for staff, `get_my_member_id()` for
  member), so fixing authorization in one place fixes it everywhere that
  function is used.
- **Supabase Auth** — real sessions for all three roles. Members get a
  synthetic email (`member-<uuid>@members.internal`) that is never shown to
  them and never receives real mail; owner/staff use real email + password.
- **Edge Functions (Deno/TypeScript)** — `supabase/functions/`:
  `member-signin` (the entire member-login security boundary),
  `create-staff-user`, `manage-staff-login`, `generate-notifications`,
  `send-push`.
- **Storage** — Aadhaar ID photos, member profile photos, generated invoice
  PDFs, all in private buckets accessed via short-lived signed URLs, never
  a public bucket URL.
- **Supabase CLI** — used for migrations and direct DB access
  (`db query --linked`), since `db push` is currently broken for this
  project (see §5).

### Key libraries (see `package.json` for exact versions)
| Package | What it's for |
|---|---|
| `@supabase/supabase-js` | The Supabase client SDK — auth, Postgres queries, RPC calls, storage, realtime. |
| `html2pdf.js` (wraps html2canvas + jsPDF) | Renders the invoice HTML template to a PDF blob for WhatsApp-sharing and download. |
| `qrcode` | Generates the desk kiosk's rotating check-in QR code. |
| `jsqr` | Decodes a QR code from camera frames on browsers without the native `BarcodeDetector` API (i.e. iOS Safari) — lazy-loaded fallback. |
| `@playwright/test` (dev) | End-to-end browser testing. |
| `eslint` (dev) | Linting — 12 pre-existing unused-variable errors are accepted baseline noise, not a target to fix (see CLAUDE.md). |

### No framework, no CSS framework, no state library, no ORM
Worth stating explicitly since their absence is a design decision, not a
gap: no React/Vue, no Tailwind/Bootstrap, no Redux/Zustand (state lives in
one plain mutable object, `S`, per dashboard session — see §6), no
Prisma/Drizzle (SQL and Postgres functions are written directly).

### Hosting & deployment
- **Vercel** — static hosting + SPA rewrites (`vercel.json`: build command
  `npm run build`, output `dist/`, all paths rewritten to `/index.html`).
  Auto-deploys on every push to the `sculpt-whitelabel` branch of
  `github.com/flymsystem/sculpt`. No CI config (no `.github/workflows`) —
  Vercel's own build step is the only automated gate.
- **Supabase project** `sculp-fitness` (ref `acigxzbbchhisaymklld`), region
  `ap-northeast-2` (Seoul) — noticeably slower per-request for Indian users
  than a Mumbai region would be; tolerable, not ideal. Moving it means
  creating a new project and migrating data, not a config change.

### Integrations
- **WhatsApp** — deep links (`wa.me/...`) for sending receipts, login
  credentials, and reminders. No WhatsApp Business API integration; these
  are plain `https://wa.me/<number>?text=<encoded>` links opened by staff.
- **No payment gateway.** Razorpay was integrated in a previous version of
  this product (to sell broadcast-message credits) and was removed along
  with that feature — see §8. Payments are recorded manually by staff
  (cash/card/online), not processed by the app.
- **No email provider.** The app never sends real email to anyone —
  members have no email in this schema, and owner/staff use Supabase Auth's
  built-in email/password without transactional email flows.
- **Web Push** — code exists (`src/lib/push.js`, `send-push` Edge
  Function, VAPID key env vars) but is **not currently enabled**: no keys
  are configured, the function isn't relied upon. In-app notifications work
  independently of this.

---

## 3. Complete directory & file map

```
├── src/
│   ├── app.js                      Router (lazy-loaded routes), boot(), LEGACY_GLOBALS cleanup
│   ├── components/                 Shared UI widgets, framework-agnostic
│   │   ├── call-button.js            One-tap "call this number" buttons + phone-number linkification
│   │   ├── confirm.js                In-app confirm dialog (replaces window.confirm — dark-theme safe, awaitable)
│   │   ├── modal.js                  The single modal system every dialog in the app is built on
│   │   ├── notification-bell.js      In-app notification bell + dropdown
│   │   ├── photo-lightbox.js         Full-screen photo viewer (Aadhaar/profile photos)
│   │   ├── photo-picker.js           Camera/file photo capture + crop UI
│   │   ├── print-preview.js          showPrintPreview() — renders any HTML doc inside an app modal iframe (never window.open())
│   │   └── toast.js                  Bottom toast notifications
│   ├── lib/                         Database access + cross-cutting services (no dashboard-only state here)
│   │   ├── addon-templates.js        CRUD for reusable membership add-ons (cardio, PT, etc.)
│   │   ├── auth.js                   Owner/staff login, session/profile loading
│   │   ├── checkin.js                Rotating-token issue + staff/member check-in RPC wrappers, attendance queries, realtime subscribe
│   │   ├── enquiries.js              Walk-in/call enquiry CRUD
│   │   ├── expenses.js               Gym expense tracking
│   │   ├── invoice-pdf.js            Renders the invoice template to a PDF blob via html2canvas
│   │   ├── invoices.js               Storage bucket access for generated invoice PDFs
│   │   ├── member-auth.js            Member sign-in (calls the member-signin Edge Function), portal data readers
│   │   ├── members.js                THE MONEY CODE — members, payments, revenue, add/renew/delete
│   │   ├── notifications.js          In-app notification read/mark-read
│   │   ├── permissions.js            hasAccess(role, action) — the owner-vs-staff permission table
│   │   ├── plans.js                  Membership plan catalog CRUD + public plan lookup
│   │   ├── push.js                   Web Push subscription management (feature not enabled — see §2)
│   │   ├── qr.js                     Lazy QR encode (kiosk) / decode (scanner) — never statically imported
│   │   ├── staff.js                  Staff CRUD, login provisioning/revocation
│   │   └── supabase.js               The Supabase client singleton
│   ├── pages/
│   │   ├── landing.js                 The public marketing website (placeholders for gym details live in the `GYM` object here)
│   │   ├── login.js                   Owner/staff login screen
│   │   ├── dashboard/                 The app itself — one file per section, all lazy-loaded
│   │   │   ├── index.js                 Orchestrator: renderGymDashboard(), nav() (section switching), wires every section together
│   │   │   ├── state.js                 The `S` singleton — S.gym, S.members, S.plans, S.role, etc.
│   │   │   ├── helpers.js               Shared dashboard helpers: escHtml(), parsePlanData(), demo data
│   │   │   ├── overview.js              Dashboard home — KPIs, alerts banner
│   │   │   ├── members.js               All Members table, filters, bulk actions
│   │   │   ├── member-modals.js         Add/Edit/Remove/Renew/Invoice/WhatsApp modals — the biggest file in the app
│   │   │   ├── plans.js                 Plan Settings CRUD + showcase page
│   │   │   ├── settings.js              Gym Settings (identity, GST/tax, timezone, reminder config)
│   │   │   ├── finance.js               Revenue/expense/pending-dues reporting by period
│   │   │   ├── expenses-page.js         Expense entry and history
│   │   │   ├── backup.js                Data & Backup — CSV exports, the Financial & GST Audit Support Report
│   │   │   ├── alerts.js                Member Alerts (expiring/expired renewal call list)
│   │   │   ├── analytics.js             Growth/revenue/plan-mix analytics
│   │   │   ├── enquiries.js             Enquiries section UI
│   │   │   ├── staff.js                 Staff CRUD UI, attendance, login management
│   │   │   ├── attendance-report.js     Staff attendance CSV/report
│   │   │   ├── invoice-template.js      The invoice/receipt HTML — shared by preview, print, and PDF paths (see §6)
│   │   │   ├── checkin-display.js       Full-screen desk kiosk QR screen
│   │   │   ├── checkin-scan.js          Staff/trainer in-app camera scanner
│   │   │   ├── checkins.js              Check-ins section: live attendance log, denied list, history
│   │   │   ├── photo.js                 Member/Aadhaar photo upload to Storage
│   │   │   └── sidebar.js               Dashboard sidebar nav, theme toggle, mobile drawer
│   │   └── member/                    The member portal — a second, much smaller app, same PWA
│   │       ├── login.js                 Application number + phone, no password
│   │       ├── index.js                 Portal shell: Check In / My Plan / My Receipts / My Visits tabs
│   │       └── receipts.js              Payment history + generated PDFs
│   └── styles/
│       ├── tokens.css                 Every colour, font, radius, spacing value — the design-token source of truth
│       ├── global.css                 Base/reset styles, static import
│       ├── components.css             Shared component styles, static import (loads before dashboard.css — see CLAUDE.md)
│       ├── dashboard.css              Dashboard-only styles, lazy import (loads after components.css)
│       └── mobile-fixes.css           Mobile overrides, must stay after dashboard.css
├── supabase/
│   ├── migrations/                  67 migration files (numbered up to 130, with gaps), applied in filename order (zero-padded so insertions sort correctly), each documented in migrations/README.md — the schema's real history
│   ├── functions/                   Deno Edge Functions
│   │   ├── member-signin/             Member login — the entire member-auth security boundary
│   │   ├── create-staff-user/         Owner provisions a new staff login
│   │   ├── manage-staff-login/        Owner resets/revokes a staff login
│   │   ├── generate-notifications/    Scheduled in-app notification generation
│   │   └── send-push/                 Web Push sender (not currently enabled)
│   └── ADMIN_QUERIES.sql            Ad-hoc reference queries for manual DB inspection
├── scripts/                         Node maintenance/verification scripts, run manually
│   ├── verify-schema.mjs              Confirms the live DB matches what the app queries (tables, RPCs, GYM_CODE drift check)
│   ├── generate-icons.mjs             Rebuilds PWA icons from the source logo
│   ├── prep-landing-images.mjs        Processes real gym photos for the landing page
│   ├── prep-logo.mjs                  Logo processing/cropping for small sizes
│   ├── qa-dashboard.mjs               Scripted dashboard walkthrough (needs credentials)
│   ├── qa-nav.mjs                     Scripted nav/logo/animation checks
│   ├── qa-responsive.mjs              Scripted responsive-layout sweep across 8 widths
│   └── shoot.mjs                      Screenshot capture utility
├── tests/                           Playwright end-to-end tests — see §7
├── agreement/                       Business/legal documents between developer and client (contract PDFs, terms) — NOT source code; see the note in §9 about public-repo exposure
├── vercel.json                      Vercel build + SPA routing config
├── vite.config.js                   Vite build config — base:'/' and manualChunks are both load-bearing, see CLAUDE.md
├── CLAUDE.md                        AI-agent working rules — hard-won "don't break this" warnings, read before changing anything
└── README.md                        Quick-start commands
```

---

## 4. Data model

**Core tables** (see `supabase/migrations/000_baseline_current.sql` for the
authoritative current shape of each, and `migrations/README.md` for the
history of how each column/function reached its current state):

| Table | Purpose |
|---|---|
| `gyms` | The single gym row — name, contact info, branding, tax identity, `owner_password` (plaintext, kept per client agreement — see below), `gym_code`, timezone, next application-number sequence. |
| `gym_users` | Links an `auth.users` id to a gym with a role (`owner` / `staff`). **Members must never appear here** — see the RLS section below. |
| `members` | The member roster — contact info, plan, pricing, payment status, application number, optional `user_id` link to their own `auth.users` row, Aadhaar number/photo. |
| `payment_history` | Every payment ever recorded, `ON DELETE CASCADE` from `members`. This is the ledger Finance/Overview/Analytics all read from. |
| `plans` | The membership plan catalog (name, price, duration, features as a JSON string — see CLAUDE.md's `plans.features` warning). |
| `addon_templates` | Reusable add-on line items (cardio, personal training, etc.) offered alongside a plan. |
| `staff` | Staff roster, separate from `gym_users` — `is_active`/`login_enabled` gate their actual access (see `get_my_gym_id_as_staff()` below). |
| `staff_attendance`, `staff_salary_payments` | Staff HR records. |
| `expenses` | Gym expenses — the one entity that's genuinely hard-deleted, not soft-deleted. |
| `enquiries` | Walk-in/call enquiry tracking. |
| `checkin_tokens` | Rotating 90-second QR tokens for the desk kiosk (self-cleaning, no cron needed — see below). |
| `member_checkins` | The attendance log — one row per scan attempt, `ON DELETE CASCADE` from `members`. |
| `member_login_attempts` | Rate-limiting + diagnostics log for member logins (server-only, no client SELECT policy). |
| `reminder_logs` | Log of manually-sent WhatsApp renewal reminders, `ON DELETE CASCADE` from `members`. |
| `notifications`, `push_subscriptions` | In-app and (unused) web-push notification delivery. |
| `activity_log` | Owner/staff action audit trail. |

### The RLS security model — three domains, three resolver functions
Every policy and RPC in the schema is gated through exactly one of these,
never a parallel or ad-hoc check:
- **`get_my_gym_id()`** — resolves the caller to a gym as its **owner**.
- **`get_my_gym_id_as_staff()`** — resolves the caller to a gym as **active,
  login-enabled staff**. Because every staff-facing policy and RPC funnels
  through this single function, fixing an authorization bug here (e.g.
  requiring `is_active AND login_enabled`, not just a `gym_users` row)
  fixes "disable this staff login" everywhere at once, with nothing else
  to remember.
- **`get_my_member_id()`** — resolves the caller to their **own member
  row**, never a caller-supplied id. Every member-facing RPC
  (`sculpt_member_checkin`, `sculpt_my_membership`, `sculpt_my_visits`,
  `sculpt_my_receipts`) ignores anything the client passes for "which
  member" — a member session can never ask for someone else's data by
  changing an argument.

**Two rules that would quietly break this boundary if violated:**
1. A member must never get a row in `gym_users` — that table is what
   `get_my_gym_id()` reads, and a member appearing there inherits gym-wide
   read access to every other member's phone, Aadhaar photo, and payment
   history.
2. `gyms` must never get a member SELECT policy — it holds `owner_password`
   in plaintext (kept per explicit client agreement, migration 022). The
   member portal reads gym name/logo through a narrow `SECURITY DEFINER`
   function instead.

### Key Postgres functions (`sculpt_*` naming — see CLAUDE.md for the rename history from a previous product's naming)
| Function | Enforces |
|---|---|
| `sculpt_add_member` / `sculpt_renew_member` / `sculpt_clear_balance` | Money + membership changes, each atomic in one transaction. Never split into steps or reimplemented in JS. |
| `sculpt_delete_member_permanently` | Owner-only hard delete — removes a member and (via `ON DELETE CASCADE`) their entire payment history, checkins, and reminder log. This is the only member-deletion path the UI offers as of 2026-08-27 (see CLAUDE.md's "Known non-issues" for the history of why). |
| `sculpt_generate_application_number` / `sculpt_regenerate_application_number` | Server-side-only generation of the `SC-####-XXX` member login identifier — never typed by staff, never derived client-side. |
| `sculpt_issue_checkin_token` | Mints a 90-second rotating QR token for the desk kiosk; self-cleans tokens older than 5 minutes on the way through. |
| `sculpt_member_checkin` / `sculpt_staff_checkin` / `sculpt_manual_checkin` | Validate a scanned token and record attendance. **Always RETURN a status, never RAISE** — a raised exception would roll back the transaction and destroy the denied-attempt evidence along with it. |
| `sculpt_my_membership` / `sculpt_my_visits` / `sculpt_my_receipts` | Narrow, member-scoped read projections for the portal. |
| `sculpt_revenue_summary` / `sculpt_revenue_monthly` / `sculpt_revenue_rows` | Revenue aggregation, read directly from `payment_history` with no join to `members.is_active` — a deleted member's historical revenue used to vanish from these on soft-delete; fixed in migration 121, since superseded by hard-delete-on-Remove (see above). |

### Member authentication (no password, no PIN)
Application number + phone number, verified entirely inside the
`member-signin` Edge Function using the service-role key. Returns the
**identical error** for a wrong application number vs. a wrong phone number
— diverging that message would make the endpoint a tool for enumerating
valid application numbers. Rate-limited by IP and by application number
before the lookup even runs. As of 2026-08-27, the function resolves "the"
gym itself server-side rather than trusting a client-supplied gym code (see
§8 for why that changed). Sessions are minted via `admin.generateLink()` +
`verifyOtp()` — never a path that actually dispatches email, since the
synthetic `member-<uuid>@members.internal` addresses don't exist.

### Check-in / anti-spoofing design
The desk kiosk's QR code is not static — it rotates every 30 seconds
(90-second token validity, so overlapping codes tolerate a slow scan) and
its payload is a custom string (`SCULPT1:<gym_code>:<token>`), not a URL, so
scanning it with a phone's native camera produces an unhelpful string rather
than a bookmarkable link. A photograph of the screen is dead within 90
seconds — that's the entire trust mechanism behind the attendance log.

---

## 5. Architecture & conventions

(Full detail and the specific outages that motivated each rule live in
`CLAUDE.md` — this is the map, not the territory.)

- **`vite.config.js` must keep `base: '/'`, never `'./'`.** With a relative
  base, refreshing a deep page like `/dashboard/finance` silently serves
  the HTML file as JavaScript and the page goes blank, with no error
  anywhere — this was live in production for months before anyone found
  it. A build-time test guards it now.
- **Import direction is `pages/ → lib/`, never the reverse.** A module
  needing dashboard state or `helpers.js` belongs in `pages/dashboard/`,
  not `lib/`.
- **Dashboard state is one mutable singleton**, `S` (`pages/dashboard/state.js`)
  — `S.gym`, `S.members`, `S.plans`, `S.role`, etc. Modules read from it
  directly rather than threading it through function parameters.
- **Routing is lazy by design** (`src/app.js`) — every route (`landing`,
  `login`, `gym`, `member-login`, `member`) is a dynamic `import()`, guarded
  by a test that fails if `landing.js`, `login.js`, or the PDF engine ever
  gets statically imported (which would defeat the lazy-load and bloat
  first paint).
- **`window._navTo`-style globals (`app.js`'s `LEGACY_GLOBALS`) must be
  re-assigned inside their render function on every render, not just at a
  module's top level** — a dynamic `import()` of an already-loaded module
  doesn't re-run its top-level code, so a global set only once becomes
  permanently stale the moment `router.go()`'s per-navigation cleanup
  deletes it (this exact bug broke the desk kiosk's exit button in
  production — see CLAUDE.md).
- **Every user-typed string goes through `escHtml()`** before reaching the
  DOM — member names are attacker-controlled.
- **Check-in timestamps are computed in the gym's timezone, never UTC**
  (`gyms.timezone`, default `Asia/Kolkata`) — the server runs UTC, so a
  bare `CURRENT_DATE` would misdate an early-morning IST check-in.
- **The invoice/print system** (`invoice-template.js`) has three consumers
  (preview iframe, browser print, PDF-for-WhatsApp) sharing one HTML
  template with three tightly-coupled numeric constraints (sheet width,
  base vs. `@media print` zoom/min-height) — see CLAUDE.md's "Invoices and
  printable documents" section in full before touching any of these
  numbers; they were tuned against measured real content, not derived
  algebraically, and a naive rescale has broken it before.
- **`.is-open` classes, never the `hidden` attribute**, on anything also
  styled with `display:` — combining them silently breaks close buttons.
- **Design tokens only** — no hardcoded hex colours in components;
  everything comes from `src/styles/tokens.css`.
- **`.topbar` has `overflow: hidden`.** Any dropdown or popup anchored in
  the top bar must attach to `<body>`, not to something inside the topbar,
  or it gets clipped.
- **No full-screen overlays on desktop, only mobile.** Even an invisible
  one swallows the first click on the sidebar and table rows underneath
  it. The landing page's intro fade is the one exception, and it obeys the
  same rule by being **removed from the DOM** when the fade ends, not just
  faded to transparent — keep the `.remove()` if you ever touch that
  animation.
- **The desk kiosk shows a visible "Offline" banner instead of leaving a
  stale QR code on screen** the instant it loses connectivity — a code
  that stopped rotating is, by definition, guessable past its intended
  window. Staff fall back to checking a member in manually from the
  members list while the tablet is down.
- **Adding a new `gym_users.role` value must also widen the
  `gym_users_role_check` CHECK constraint that gates it**, in the same
  migration — not a later one. The staff-login feature once shipped
  entirely built around `role = 'staff'` (RLS policies, Edge Functions)
  without ever widening the original `CHECK (role IN ('owner', 'admin'))`
  constraint, so every attempt to create a staff login failed silently at
  the insert until someone actually tried it.

---

## 6. Environment & configuration

| Variable | Where read | Public or secret |
|---|---|---|
| `VITE_SUPABASE_URL` | Client bundle (`import.meta.env`) | Public — baked into the build. |
| `VITE_SUPABASE_ANON_KEY` | Client bundle | Public by design — protected by RLS, not secrecy. |
| `VITE_PUBLIC_GYM_CODE` | `landing.js` (public plans lookup), `member-auth.js`'s old GYM_CODE logic | Public; optional override, falls back to a hardcoded value if unset — see `scripts/verify-schema.mjs`'s drift check. |
| `VITE_VAPID_PUBLIC_KEY` | Client (web push, not enabled) | Public (VAPID public keys are meant to be). |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only (Deno) | `SERVICE_ROLE_KEY` is the dangerous one — **never** put it in any file under `src/` or in `.env.local`; it bypasses RLS entirely. |
| `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | `send-push` Edge Function (not enabled) | Private key is secret. |
| `CRON_SECRET` | `generate-notifications` Edge Function | Secret — authenticates the scheduled trigger. |

Local dev: `.env.local` holds the two `VITE_SUPABASE_*` values (see
README.md). It is gitignored; it was accidentally committed at the project
baseline and has since been untracked (`git rm --cached`) — if `git status`
ever shows it as tracked again, stop and untrack it before committing.
Production env vars live in Vercel project settings, not read from
`.env.local` in the deployed build.

---

## 7. Testing

**Playwright**, `tests/` — one spec file per feature area. Two tiers:
- **No credentials needed** — public pages, landing content, build
  integrity, lazy-load guards, pure-logic tests (renewal date math). Runs
  with plain `npx playwright test`.
- **Needs real credentials** — anything requiring a signed-in session.
  Gated by `test.skip(!EMAIL || !PASSWORD, ...)` at the top of each file.
  Requires `SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD` (owner) and, for a
  handful of staff-specific tests, `SCULPT_STAFF_EMAIL`/`SCULPT_STAFF_PASSWORD`.
  **Must run with `--workers=1`** — multiple simultaneous sign-ins from one
  IP trip Supabase's auth rate limit and fail like a broken app, not a
  throttled one.

```bash
npx playwright test                                     # no-credential tests
SCULPT_TEST_EMAIL=... SCULPT_TEST_PASSWORD=... npx playwright test --workers=1
node scripts/verify-schema.mjs                          # DB-matches-code check
```

Counts drift as tests are added — treat a run's shape ("does this still
look roughly right") as the signal, not an exact number to chase. As of the
most recent full credentialed run: ~88 passed, one long-standing
pre-existing failure (`security.spec.js:201`, needs a genuine staff login,
not owner) and a handful of staff-credential-gated tests skipped/did-not-run.

For UI work: **render the real thing and measure it**, don't reason about
CSS from source. Printable documents can be checked with fixture HTML plus
`page.emulateMedia({ media: 'print' })`; the actual PDF export path has to
be exercised through the app, because html2canvas behaves differently from
the browser's native print engine.

---

## 8. What was removed, and why

This app is a stripped-down, single-tenant descendant of a previous
multi-gym product. If something looks conspicuously absent, it's probably
one of these, removed deliberately:

| Removed | Why |
|---|---|
| Superadmin panel | Managed many gyms from one login — this app has one gym. |
| WhatsApp bulk broadcast | Paid feature; reminders are sent manually now. |
| Razorpay | Existed only to sell broadcast-message credits. |
| Automatic reminders | Sent by hand from Member Alerts instead. |
| Contact Us form | Replaced by direct phone/WhatsApp per client preference. |
| Pro/Core plan tiers | Single product, nothing to upgrade to. |
| Subscription billing page | Billed the gym for its *software* plan — no vendor relationship like that exists for this deployment. |
| Certificate verification page | Belonged to the previous product entirely; contained a real person's private details. |

**Kept deliberately:** the owner/staff permission split — staff cannot see
Finance, Settings, Backup, or staff management. That's real access control,
not a sales tier, and it stays.

---

## 9. Known issues, tradeoffs, and non-issues

**Do not "fix" these — they're intentional:**
- 12 ESLint unused-variable errors — pre-existing, cosmetic.
- The sidebar animates `width` (not `transform`) on purpose, in lockstep
  with the content area's margin.
- Old migration files still reference the previous product's name
  (`is_flym_admin`, `flym_*`) — they're the historical record of what
  actually ran; the live database uses `sculpt_*` names throughout.
- Deleting a member is now a genuine hard delete (erases payment history
  too, no Undo) — a deliberate 2026-08-27 reversal of an earlier
  soft-delete-keeps-revenue design, made at the client's explicit request.
  Deleting anything else (staff, plans, add-on templates) still just sets
  `is_active = false`, except expenses, which really are deleted.

**Genuinely open, worth knowing about:**
- **The kiosk's desk-display exit is a tap + confirm dialog, not a
  security gate.** Removed a 3-second hold-to-exit after it failed live
  during a demo; the client was shown a PIN/auto-return comparison and
  chose a plain confirm dialog instead. This is a speed bump against an
  *accidental* tap, not protection against a *deliberate* one — the
  tablet's actual security is physical supervision. This was an informed,
  explicit choice, not an oversight.
- **`npx supabase db push` is broken for this project** — the remote's
  tracked migration history diverged from local files starting around
  migration 102 (every migration `102`+ shows as unrecorded even though
  its schema changes are demonstrably live). New migrations are applied
  directly via `npx supabase db query --linked -f <file>` and independently
  verified against live `information_schema`/`pg_proc`, not via `db push`.
  Repairing the migration ledger itself is a separate, riskier job that
  hasn't been done.
- **Web Push is built but not enabled** (see §2, §6) — no keys configured.
- **Two of the landing page's six photo slots are still stock imagery**
  (Personal Training, Group Classes) pending two more real photos.

**Public GitHub repo — things worth knowing:**
- No live secrets are committed. `.env.local` was briefly tracked at the
  project's very first commit but only ever contained the public anon key
  and Supabase URL (values meant to be public) — never a service-role key
  or database password. It's gitignored now.
- `agreement/` contains real business documents (signed service-terms
  PDFs, pricing) between the developer and the client — this is business
  correspondence, not source code, and its presence in a **public** repo is
  a judgment call worth revisiting; it wasn't put there to be published.
- The database stores `gyms.owner_password` in plaintext (kept per an
  explicit client agreement — see CLAUDE.md) and member Aadhaar
  numbers/photos. None of that data itself is in the repository or git
  history — it lives only in the production database — but it's worth
  knowing the schema documents its own existence in migration files that
  are, on a public repo, world-readable.

---

## 10. Deployment

```
git push origin sculpt-whitelabel
```

is the entire deploy — Vercel watches that branch and auto-builds/deploys
on every push, live at the production URL within about a minute. There is
nothing to upload by hand, and no separate CI step; Vercel's own build
(`npm run build`, pinned in `vercel.json`) is the only automated gate.

To build and smoke-test locally first (recommended — a broken deep-route
refresh is a silent failure mode, see §5's `vite.config.js` note):

```bash
npm run build
npm run preview           # serves dist/ on :4173
```

Hard-refresh (Ctrl+Shift+R) a deep route like `/dashboard/finance` in the
preview before pushing — if it goes blank, stop and check `vite.config.js`'s
`base` setting before anything else.

To deploy from your own machine without waiting on a push:

```bash
npx vercel --prod
```

Environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) live
in Vercel's project settings, scoped per environment, and are not read from
`.env.local` in the deployed build — that file only matters for local
`npm run dev`/`npm run preview`.

If a deploy looks stale to a visitor, it's almost always the **service
worker** caching the previous build in their browser, not a bad deploy — a
hard refresh clears it.

**Windows + an antivirus that scans HTTPS traffic (e.g. Kaspersky):** the
Vercel CLI (`vercel login`, `vercel --prod`, etc.) fails with
`TypeError: fetch failed` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, because
Node doesn't trust the antivirus's re-signed certificate by default. Fix:
`$env:NODE_OPTIONS="--use-system-ca"` in the terminal before running any
`vercel` command, so Node uses Windows' own certificate store instead.
