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
| Supabase project | `sculp-fitness` |
| Project ref | `acigxzbbchhisaymklld` |
| Dashboard | https://supabase.com/dashboard/project/acigxzbbchhisaymklld |
| Region | `ap-northeast-2` (Seoul) |
| Owner login | `sculptfit@gmail.com` |
| Gym code | `SCULPT01` |

> **Change the owner password.** It is currently `sculpt12345`, which is
> weak and was sent in chat. Supabase dashboard → Authentication → Users →
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
- **Check-in RPCs (`sculpt_staff_checkin`, and the member equivalent)
  must RETURN a status, never RAISE.** A raised exception rolls back
  the transaction and takes the denied-attempt row with it — see
  `CLAUDE.md`'s "Conventions" section for the full rationale.
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
  checkin.js                      rotating-token issue + staff check-in RPC wrappers
  qr.js                           lazy QR encode/decode — never statically imported
src/pages/landing.js              the public website  <- placeholders live here
src/pages/login.js                login screen
src/pages/dashboard/              the app itself, one file per section
  invoice-template.js             the invoice/receipt HTML — shared by the preview, print and PDF paths
  checkin-display.js              full-screen desk kiosk QR screen
  checkin-scan.js                 staff/trainer in-app camera scan
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
