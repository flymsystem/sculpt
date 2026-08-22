# CLAUDE.md

Working notes for AI agents on this codebase. Read this first, then
**[HANDOVER.md](HANDOVER.md) §6 "Things that will break it"** before changing
anything. [README.md](README.md) has the commands.

## What this is

A single-gym management app plus public website for D Sculpt Fitness.
Plain JavaScript + Vite, no framework. Supabase (Postgres, Auth, RLS) on the
back. Installable as a PWA.

There is **one gym**. Multi-tenant machinery, plan tiers, and a superadmin
panel were all deliberately removed — see HANDOVER §7 before you reintroduce
anything that looks like them. The owner/staff permission split is real
access control and stays.

## Layout and boundaries

```
src/app.js                routing; pages are lazy-imported on purpose
src/lib/                  database access + cross-cutting services
src/pages/landing.js      public website
src/pages/dashboard/      the app, one file per section
src/styles/tokens.css     every colour, font and spacing value
supabase/migrations/      applied in filename order, zero-padded
```

Import direction is `pages/ → lib/`, never the reverse. A module that needs
dashboard state or `helpers.js` belongs in `src/pages/dashboard/`, not
`src/lib/` — that is why `invoice-template.js` lives beside its helpers while
`invoice-pdf.js` (which needs neither) sits in `lib/`.

Dashboard modules share a mutable singleton `S` from
`src/pages/dashboard/state.js` (`S.gym`, `S.members`, `S.plans`, `S.role`, …).
Read from it; don't thread it through parameters.

## Conventions

- **Match the surrounding file.** This codebase writes long explanatory
  comments above non-obvious code, saying *why*, often citing the outage or
  bug that motivated it. Keep that voice; don't strip those comments.
- **Every user-typed string goes through `escHtml()`** before reaching the
  DOM. Member names are attacker-controlled.
- **Check-in timestamps are computed in the gym's timezone, never UTC.**
  `gyms.timezone` (migration 103) holds an IANA name, default
  `'Asia/Kolkata'`. Any function that writes a check-in date/time must
  compute it as `(now() AT TIME ZONE g.timezone)`, never `CURRENT_DATE` or
  `now()::date` — the server runs UTC, so a 6am IST check-in would
  otherwise land on the previous day's row. See `sculpt_staff_checkin` in
  `106_staff_checkin.sql` for the pattern.
- **In a `LANGUAGE plpgsql` function, `RETURNS TABLE (col1 type1, ...)`
  implicitly declares `col1`, etc. as ordinary PL/pgSQL variables for the
  whole function body** — not just documentation of the output shape. If
  the body also touches a table with a same-named column, any bare
  reference to that name is ambiguous and Postgres raises `42702`
  ("column reference is ambiguous... could refer to either a PL/pgSQL
  variable or a table column") the moment that line actually runs —
  which won't be caught by `CREATE FUNCTION` succeeding, only by calling
  it. `sculpt_issue_checkin_token()`, `sculpt_member_checkin()` and
  `sculpt_manual_checkin()` all shipped broken this way (`token`/
  `expires_at` vs. `checkin_tokens`, `status` vs. `member_checkins`) —
  see `111_fix_returns_table_column_shadowing.sql` for the fix and the
  full audit. Rule going forward: if a `plpgsql` function's body
  references a table sharing a column name with one of its own
  `RETURNS TABLE` outputs, qualify every reference to that table (an
  alias like `mc.status` is enough) — don't rely on bare column names
  once both a variable and a column could answer to it. `LANGUAGE sql`
  functions are not affected (no PL/pgSQL variable layer to shadow with),
  and an INSERT's column-list (`INSERT INTO t (status, ...)`) is not an
  ambiguity site either — only expressions are.
- **Check-in functions RETURN a status, never RAISE.**
  `sculpt_staff_checkin` (and the member equivalent landing in a later
  migration) always returns `(status, message)`, even for a rejected
  scan. A `RAISE EXCEPTION` rolls back the whole transaction — for the
  member version that would delete the denied-attempt record along with
  everything else, silently destroying the owner's renewal call list.
  Same convention as the money functions never raising mid-transaction,
  just for a different reason (rollback-destroys-evidence vs.
  partial-completion).
- **The member RLS boundary is `get_my_member_id()`, never a caller-
  supplied id.** Every member-facing function (`sculpt_member_checkin`,
  `sculpt_my_membership`, `sculpt_my_visits`, `sculpt_my_receipts`)
  resolves `auth.uid()` to a member row itself and ignores anything the
  client passes for "which member" — a member session must never be able
  to ask for someone else's data by changing an argument. `members` and
  `payment_history` also carry an additive `member_read_own_row` /
  `member_read_own_payments` RLS policy (migration 104) scoped the same
  way — every existing owner/staff policy stays untouched.
- **Members are never rows in `gym_users`, and `gyms` never gets a member
  SELECT policy.** See HANDOVER.md §6 for why — this is the one rule in
  the whole feature that would quietly undo the RLS boundary above if
  broken.
- **Application numbers are generated server-side, inside
  `sculpt_add_member` / `sculpt_regenerate_application_number`
  (`sculpt_generate_application_number`, migration 104), never typed by
  staff and never derived client-side.** Format `SC-####-XXX` — a
  sequence (`gyms.next_application_seq`, advanced by a row-locking
  `UPDATE`) plus a 3-character random suffix. There is no PIN or
  password on the member login, so a guessable number plus a phone
  number half the neighbourhood knows would be a login system with no
  real second factor — the random suffix is what prevents that.
- **Member login has no password.** `supabase/functions/member-signin`
  verifies application number + phone against `members`, rate-limits by
  IP and by application number (`member_login_attempts`, migration 104)
  *before* doing the lookup, and returns the identical error for a wrong
  number vs. a wrong phone — diverging that message is a member-
  enumeration oracle, not a UX nicety. It mints a session via
  `admin.generateLink()` + `verifyOtp()`, never `signInWithOtp` or any
  path that actually sends mail — the synthetic `member-<uuid>@members.internal`
  addresses don't exist and would bounce.
- **Money and membership logic lives in Postgres functions**
  (`sculpt_add_member`, `sculpt_renew_member`, `sculpt_clear_balance`) and is
  atomic on purpose. Do not split them into steps or reimplement their
  arithmetic in JS.
- **Never widen a static import** into `landing.js`, `login.js`, or the PDF
  engine. Lazy loading is guarded by a test.
- Use `.is-open` classes, never the `hidden` attribute, on anything you also
  style with `display:`.
- **The `popstate` handler in `src/app.js` must no-op when the resolved
  page equals `router.current`.** Chromium fires `popstate` — not just
  `hashchange` — for a plain same-page anchor click (`<a href="#why">`),
  and `router.go()` has no "already on this page" guard of its own. Remove
  that check and every landing-page nav link (Why us, Training,
  Membership, About, Contact) tears the whole page down and rebuilds it on
  click, replaying the intro animation every time instead of letting the
  browser scroll to the section.
- **The session object that lands in `window.__sculptSession` is built in
  two separate places** — `boot()` in `src/app.js` (page load/refresh) and
  the login-form submit handler in `src/pages/login.js` (a fresh sign-in;
  `boot()` doesn't run again for it) — plus a third, `switchGym()`'s
  handler in `sidebar.js`. All three must forward every field
  `getMyProfile()` returns, `staffRecord` included. `boot()` and
  `login.js` both dropped it (destructured `{ role, gym, branches }` only)
  from the day `getMyProfile()` started returning it — `S.staffRecord`
  (`dashboard/index.js`) was silently `null` for every staff session, in
  every browser, until this was caught by a Playwright test finally
  signing in as a real staff account instead of the owner. `sidebar.js`
  had it right the whole time. If `getMyProfile()` grows another field,
  grep for all three call sites, not just one.
- **A migration that `CREATE OR REPLACE`s or `DROP + CREATE`s a function
  by copying an older version of that function's body can silently
  reintroduce a bug an earlier migration already fixed in a *different*
  copy of that body.** `104_member_accounts.sql` needed a new
  `sculpt_add_member` signature (extra trailing params) and, per its own
  comment, wrote the new body by copying the pre-`033`-rename source —
  which turned out to also predate two fixes: `038`'s
  `member_addons` text→jsonb cast, and (separately)
  `100_sculpt_rename_identifiers.sql`'s helper rename meant one internal
  call was left pointing at the pre-rename name. Both shipped broken and
  both were only caught by actually calling the RPC end-to-end, not by
  reading the migration. When copying a function body forward, diff it
  against the CURRENT (most recently `CREATE OR REPLACE`d) version of
  that same function, not just the version being extended.
- **`get_my_gym_id_as_staff()` gates almost every staff-facing RLS policy
  and RPC in this schema — it must check `staff.is_active` AND
  `staff.login_enabled`, not just that a `gym_users` row with
  `role = 'staff'` exists** (see `115_staff_login_revocation.sql`). Because
  every staff permission check funnels through this one function,
  fixing it here is what makes "disable this staff member's login" or
  "remove this staff member" revoke access immediately and everywhere,
  with no separate step to remember. Do not add a second, parallel way
  to check staff authorization — route through this function.

## Invoices and printable documents

`showPrintPreview(title, html, opts)` renders a complete HTML document inside
an app modal (iframe), never `window.open()` — on iOS standalone PWAs a second
window has no back affordance and traps the user.

The membership invoice lives in **`src/pages/dashboard/invoice-template.js`**
and has three consumers: the preview iframe, the browser print dialog, and the
PDF blob that gets uploaded and WhatsApp'd. Three constraints are load-bearing:

1. **The sheet width is 660px in three places that must agree** — `.page` in
   `invoice-template.js`, and both `container.style.width` and
   `html2canvas.windowWidth` in `src/lib/invoice-pdf.js`. html2pdf maps that
   width onto A4 portrait; a mismatch silently rescales the exported PDF while
   the on-screen preview still looks correct.
2. **Every CSS rule is scoped to `body.inv-doc` or `.page`.** The PDF path
   injects this markup with `innerHTML` into the *live app document*, and
   `innerHTML` keeps `<style>` blocks — a bare `body { }` rule here repaints
   the dashboard for the duration of the render.
3. **The A4 budget is 933px of content** (660 × 297/210). A single-plan
   invoice lands around 896px. Measure after any edit; a GST invoice with
   several add-ons legitimately runs to a controlled second page, which is why
   `break-inside: avoid` sits in the *base* stylesheet and not inside
   `@media print` — html2canvas renders in screen mode and never sees print
   rules.

Anything scoped to `@media screen and (max-width: …)` must stay **below**
660px, or it fires during PDF export. `invoice-pdf.js` also forces
`target.style.zoom = '1'` for the same reason.

Print behaviour, palette, and the fixture set used to verify all of this are
documented in the header comment of `invoice-template.js`.

## Design system

Manrope everywhere; Barlow Condensed for large marketing headlines only.
All colour, spacing and radius values come from `src/styles/tokens.css` —
don't hardcode hex values in components.

The dashboard's brand blue `#0A84FF` is tuned for a near-black UI and only
reaches ~3.1:1 on white. Printed or light-background surfaces use the
light-theme tone `#0A63C4` instead. Invoices carry a print-safe copy of the
palette as constants rather than importing tokens, because they render as a
standalone document with no access to the app's stylesheets.

## Verifying a change

```bash
npm run build                 # must succeed
npx playwright test           # 20 pass, 4 skip without credentials
npm run lint                  # 12 pre-existing errors; add none
node scripts/verify-schema.mjs
```

Hard-refresh a deep route such as `/dashboard/finance` against
`npm run preview` before shipping — that failure mode is silent.

For UI work, render the real thing and measure it rather than reasoning about
CSS. Printable documents can be checked with fixture HTML plus
`page.emulateMedia({ media: 'print' })`; the PDF path itself has to be
exercised through the app, because html2canvas behaves differently from the
browser's own print engine.

## Known non-issues — do not "fix"

- 12 ESLint unused-variable errors, all pre-existing and cosmetic.
- Sidebar animates `width` on purpose; the content margin animates in lockstep.
- Old migration files still name the previous product (`is_flym_admin`). They
  are the record of what already ran. The live database uses `sculpt_*`.
- Deleting sets `is_active = false` everywhere except expenses, which really
  are deleted.

## Environment

Windows, PowerShell. `&&` chaining and `$(...)` are bash syntax and fail;
`curl` is not real curl (use `curl.exe`). A Bash tool is also available and
takes normal POSIX syntax.
