# D Sculpt Fitness — Handover

Everything you need to run, deploy and maintain this app. Written for
someone who is not a full-time developer: every command says where it runs.

---

## 1. What this is

A gym management app for **D Sculpt Fitness**, plus its public website.

| Piece | Where it runs |
|---|---|
| Website + dashboard | Static files you upload to Cloudflare Pages |
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

---

## 3. Deploying

There is no automatic deploy. You build on your machine and upload.

In the VS Code terminal, in this folder:

```
npm run build
npm run preview
```

Open http://localhost:4173, then **hard-refresh** (Ctrl+Shift+R) on a deep
page like `/dashboard/finance`. If it loads, the build is good. If it goes
blank, stop — see "Things that will break it" below.

Then upload the whole **`dist`** folder to Cloudflare Pages.

After uploading, if the site looks stale, visit `/unstick/` on the live
site. That clears the old cached version.

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

---

## 5. What the client still owes

Everything below renders as a visible `[PLACEHOLDER: …]` on the live site.
Nothing was invented — no fake address, no made-up class times, no
fictional trainers, no invented member counts.

**All of these live in one place:** the `GYM` object at the top of
`src/pages/landing.js`. Replace the values and rebuild.

- [ ] Phone number
- [ ] WhatsApp number
- [ ] Email address
- [ ] Street address
- [ ] Area, city, PIN
- [ ] Weekday opening hours
- [ ] Weekend opening hours
- [ ] Google Maps link
- [ ] A proof point for the hero ("training N members since YEAR")
- [ ] Confirm the four programmes match what the gym actually offers
- [ ] Four programme photos (they currently show `[PHOTO]` blocks)

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
  the first click on the sidebar and table rows. Mobile only.
- **Deleting hides, it does not erase** (`is_active = false`) — except
  expenses, which really are deleted. Do not "fix" that difference.
- **Any text a user typed must go through `escHtml()`** before being put on
  the page, or the app can be attacked through a member's name.
- **Pages and the PDF engine load on demand.** The PDF engine is ~935 kB
  and must only download when someone actually makes a PDF. A test guards
  this too.

### PowerShell notes (your terminal)

- `curl` is not real curl. Use `curl.exe`, and add `--ssl-no-revoke` on
  your university network.
- `&&` chaining and `$(...)` are bash syntax and will not work.

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
- **Four animation warnings** about animating `width`/`height` (the
  sidebar collapse and the chart bars). Fixing them would either break the
  sidebar layout or distort the rounded bar ends. Left on purpose.
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
src/app.js                  routing
src/lib/                    database access
  members.js                members, payments, revenue (the money code)
  auth.js                   login and profile loading
  permissions.js            who can see what (owner vs staff)
src/pages/landing.js        the public website  <- placeholders live here
src/pages/login.js          login screen
src/pages/dashboard/        the app itself, one file per section
src/styles/tokens.css       all colours, fonts and spacing
scripts/generate-icons.mjs  rebuilds app icons from sculp-logo.png
scripts/verify-schema.mjs   checks the database matches the code
supabase/migrations/        database history, applied in filename order
tests/                      automated checks
```

**Fonts:** Barlow Condensed for big website headlines, Manrope everywhere
else. Set in `src/styles/tokens.css`.

**Icons:** regenerate with `node scripts/generate-icons.mjs` if the logo
changes. Sizes 96px and below use a cropped version of the emblem, because
the full badge is unreadable that small.
