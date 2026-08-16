# D Sculpt Fitness — White-Label Build Design

**Date:** 16 August 2026
**Status:** Approved, pre-implementation
**Source:** `sculp-fitness/` — a full copy of the Flym multi-tenant gym SaaS

---

## 1. Goal

Turn a clone of Flym (a multi-tenant gym-management SaaS with 8 live gyms) into a
standalone, single-tenant product for one client: **D Sculpt Fitness**.

The deliverable is a complete handover: their own website, their own dashboard, their
own Supabase backend, their own branding. No shared infrastructure with Flym, and no
visible trace of Flym anywhere a user, client, or casual code reader would encounter it.

**Canonical brand name:** `D Sculpt Fitness` (with the T, matching the logo artwork).
This exact string goes in page titles, the PWA manifest, invoice and PDF headers, and
all user-facing copy.

### Non-goals

- Migrating any Flym data. The new database starts empty.
- Preserving multi-gym capability as a *feature*. The plumbing stays (see §5.3); the UI does not.
- Adding capabilities Flym did not already have, beyond the new landing page.

---

## 2. Constraints inherited from Flym

These are load-bearing and must survive unchanged. Each was a production bug once.

| Constraint | Why |
|---|---|
| `vite.config.js` keeps `base: '/'` | `'./'` makes deep-link hard refresh return `index.html` with a 200, which the browser parses as JavaScript. Blank page, no 404 to point at it. |
| Money RPCs stay invoker-rights, not `SECURITY DEFINER` | They run as the caller so existing RLS applies unchanged. A definer version would have to re-implement tenant authorisation by hand. |
| Money RPCs stay single-transaction | Prevents split payment/membership writes on a flaky connection. |
| `.topbar` has `overflow: hidden` | Any overlay anchored there must be portaled to `<body>` and positioned from `getBoundingClientRect()`. |
| Never combine the `hidden` attribute with a `display:` style | Author CSS beats the UA stylesheet, the element stays visible, and every close path silently fails. Use a `.is-open` class. |
| No full-screen backdrops on desktop | Even a transparent one swallows the first click on the sidebar and table rows. Mobile only. |
| Soft delete (`is_active = false`) everywhere except expenses | Expenses hard delete. This asymmetry is intentional. |
| `escHtml()` / `escAttr()` wrap all user-entered text before `innerHTML` | XSS. |
| Routes and the PDF engine stay lazy-loaded | Entry JS is ~15 kB; `vendor-pdf` is ~935 kB and must only download on demand. |

---

## 3. Brand system

Derived from `sculp-logo.png`: a circular chrome badge, deep black ground, electric-blue
wordmark and figure, metallic silver rings and dumbbells.

**Palette**

| Role | Value | Notes |
|---|---|---|
| Ground | `#050507` | Near-black, matches the logo's field |
| Surface | `#0E0F13` | Cards, panels |
| Action / primary | `#0A84FF` → `#1E90FF` | Electric blue, gradient for emphasis |
| Chrome | `#C8CDD6` | Borders, secondary text, metallic accents |
| Text | `#F2F4F8` | |

**Decision — dark theme stays.** Not as a carry-over from Flym, but because the brand is
genuinely dark-native: the logo is blue-and-chrome on black and reads badly on white.
The tokens are rebuilt from scratch around these values rather than recoloured.

**Register split.** The landing page runs hot — heavier blacks, blue glow, large kinetic
type. The dashboard runs calm — the same palette at lower saturation, optimised for
legibility, because staff use it for hours.

**Icons.** Favicon and all PWA sizes are generated from the logo. Sizes at or below 96px
use a simplified blue-on-black mark, because the full badge (three concentric rings plus
two dumbbells) becomes unreadable mush when downscaled.

---

## 4. What is removed

Import graph verified before deletion; nothing outside each group references it.

### 4.1 Superadmin

`src/pages/admin-dashboard.js` (1,818 lines), `src/lib/admin.js` (189 lines), and the
`admin` route in `src/app.js`.

All eight exports of `admin.js` are cross-gym operations — `getAllGymsDetail`,
`getGymStats`, `getGlobalActivity`, `onboardGym`, `deactivateGym`, `reactivateGym`,
`getDueReminders`, `markReminderSent`. Its only importer is `admin-dashboard.js`. Nothing
owner-facing is lost.

### 4.2 Broadcast and payments

`src/pages/dashboard/broadcast.js` (930 lines), `src/lib/broadcast.js`, the nav entry, and
the Razorpay SDK `<script>` in `index.html`. A case-insensitive grep for `razorpay`
returns hits in exactly six files, all broadcast-related — no other feature depends on it.

Edge functions removed: `create-broadcast-order`, `process-broadcast`, `whatsapp-webhook`
(exists solely to record broadcast delivery receipts), `send-reminders`, `create-gym-user`
(the admin-only gym-creation path, which no longer has a caller).

### 4.3 Automatic reminders

`send-reminders` and its `CRON_SECRET` / pg_cron wiring.

**Consequence, stated explicitly:** automatic reminders become genuinely absent, not
hidden. The client's stated workflow is manual sending, and the Member Alerts page
computes its own list client-side, so the manual flow is unaffected. But this is a
capability removal, not a UI change.

### 4.4 Contact form

`src/pages/dashboard/contact.js`, its nav entry, its permission key, and the
`support_messages` table. The landing page reaches the gym via `tel:` / WhatsApp
deep-link / `mailto:` — no form, no database write, no ticket queue.

### 4.5 Subscription tiers

`src/lib/tiers.js` and its ten call sites across `dashboard/index.js`, `overview.js`,
`sidebar.js` and `staff.js`, including the "FLYM PRO" / "FLYM CORE" sidebar badge.

**What survives:** `src/lib/permissions.js` in full. The `owner` / `staff` matrix is real
access control — staff still cannot reach Finance, Settings, Backup, or staff management.
Only the commercial "upgrade to unlock" layer is removed. Every feature previously gated
behind Pro (`broadcast`, `auto_reminders`, `staff_login`, `analytics`) is either deleted
outright or becomes unconditionally available.

The `gyms.subscription_tier` column is left in place, unread. Dropping it buys nothing and
risks a view rebuild.

### 4.6 Dead routes

`/dashboard/broadcast` and `/dashboard/contact` redirect to the dashboard home. Visiting
a stale bookmark must not throw.

---

## 5. Backend

### 5.1 New Supabase project

D Sculpt Fitness gets its own project, on a Supabase account Steven creates under a
separate email. He runs `npx supabase login`; everything after that is scripted.

The Flym project (`ogxqspnqtjphprqzwuye`) is never touched, and the new `.env.local` never
points at it.

### 5.2 The migrations folder is untrusted

Flym's own notes record that migrations 008, 009, 020, 021 and 026 were run directly
against production and never saved, and that the `expenses` table, `invoices` table,
`gyms.gst_percentage`, `plans.is_featured` and all storage buckets are created by no
migration in the repo. The conclusion in Flym's own documentation is that the repository
**cannot rebuild the database**.

So the numbered migrations are treated as a starting point, not a source of truth:

1. Apply every existing migration to the new empty project and record what fails.
2. Extract the full set of tables and columns the application actually reads, by
   enumerating every `.from()`, `.select()`, `.insert()`, `.update()` and `.rpc()` call
   in `src/lib/` and `src/pages/`.
3. Diff that against the schema that actually materialised.
4. Write the gaps as **new** migration files. Old numbered files are never hand-edited.

The end state is a repository that can rebuild its own database from zero — which fixes a
real defect inherited from Flym rather than reproducing it.

### 5.3 Multi-tenant plumbing stays

`get_my_gym_id()` and gym-scoped RLS remain. For a single gym they are inert, and removing
them would mean rewriting every policy in the schema — strictly more risk than leaving
them. No gym-switcher or multi-gym UI is built.

### 5.4 Identifier renaming

Database identifiers carrying the Flym name are renamed:

| Old | New |
|---|---|
| `flym_add_member` | `sculpt_add_member` |
| `flym_renew_member` | `sculpt_renew_member` |
| `flym_clear_balance` | `sculpt_clear_balance` |
| `flym_revenue_summary` / `_monthly` / `_rows` | `sculpt_revenue_*` |
| `is_flym_admin()` | dropped with the admin role |
| `flym-cleanup-old-logs` cron job | `sculpt-cleanup-old-logs` |
| `flym-resume-broadcasts` cron job | dropped |

Renaming an RPC is normally risky because of the client's missing-function fallback path.
Here it is safe: the database is new and empty, both sides are written together, and there
is no deployed client to fall out of sync with. Transaction boundaries, `FOR UPDATE`
locking and RLS behaviour stay byte-for-byte identical — only the identifier changes.

### 5.5 Storage buckets

`member-photos`, `gym-logos`, `aadhar-photos`, created with the access policies the app
expects (`{gymId}/{memberId}.jpg` paths). These are created manually in Flym; here they
are scripted so the setup is reproducible.

### 5.6 Seeding the first account

Flym's owner-creation path ran through the admin panel, which no longer exists. The
initial gym row and owner auth user are therefore created once, directly, via SQL and the
Admin API. This is a one-off bootstrap, not a feature.

### 5.7 Edge functions deployed

`create-staff-user` only. Every other function is either deleted (§4.2) or was already
undeployed in Flym (`send-push`, `generate-notifications`) and stays that way.

---

## 6. Landing page

`src/pages/landing.js` (1,506 lines) is replaced outright, not find-replaced.

Sections: hero, why-join / USPs, programme highlights, location and contact, CTA into
login. High-impact and physical rather than generic-SaaS — this is gym marketing, not a
software pitch.

All copy and imagery the client must supply is marked with an unmissable placeholder
convention and collected into a single checklist at handover. Nothing fabricated ships
looking real: no invented testimonials, no fake addresses, no stock trainer names presented
as staff.

Contact is a `tel:` link, a WhatsApp deep link and a `mailto:` — no form.

---

## 7. Verification

Every phase ends with a build and a browser check. "The code looks right" is not a
completion signal.

**Per phase:** `npm run build` succeeds; entry bundle has not grown (a jump means
something dynamic became static).

**Before any phase is called done:** `npm run preview`, then hard-refresh at least three
deep routes (`/dashboard/finance`, `/dashboard/members`, `/dashboard/staff`). This single
check catches the whole base-path failure class.

**Playwright:** landing page at mobile and desktop widths; login → dashboard end-to-end
against the new project; Member Alerts call and WhatsApp links still resolve; old
broadcast and contact URLs redirect instead of crashing.

**Final grep:** case-insensitive `flym` across `src/`, `public/`, `index.html` and
`supabase/` returns zero matches outside historical documentation.

**Impeccable pass:** full UI/UX audit, with what was checked and what was fixed written
down rather than asserted.

---

## 8. Sequencing

Phases 1–4 touch no backend and can complete while the Supabase account is being set up.

| # | Phase | Blocked on |
|---|---|---|
| 1 | Strip — admin, broadcast, Razorpay, contact, tiers | — |
| 2 | Rebrand — all `flym` references, icons, manifest, service worker, PDF headers | — |
| 3 | Brand system — tokens, generated icon set | — |
| 4 | Landing page rebuild | — |
| 5 | Backend — project, schema, buckets, seed, functions | Steven's `supabase login` |
| 6 | Verification — build, deep links, end-to-end | 5 |
| 7 | Impeccable polish | 6 |

Each phase ends with a written checkpoint: what changed, why, and what to look at. Steven
is not a professional developer; a single diff at the end is not a handover.
