You are building the QR check-in system and member portal for **D Sculpt Fitness**, an existing production gym-management app in this repository.

## Before you write a single line

Read these, in this order, completely:

1. `CLAUDE.md` — the conventions you must match
2. `HANDOVER.md` — especially **§6 "Things that will break it"**. Every item there caused a real outage. Treat them as law.
3. `CHECKIN-PLAN.md` — the architecture for this feature, already agreed with the client
4. `supabase/migrations/README.md` — migration rules
5. `src/pages/dashboard/member-modals.js`, `src/pages/landing.js`, `src/app.js`, `src/lib/permissions.js`, `src/lib/staff.js`

Use the **superpower** skill to plan this properly before building, **ui-ux-pro-max** for every screen you create, and **playwright** to verify by rendering and measuring rather than by reasoning about CSS. Do not skip the visual verification step — this codebase's own instructions say to render the real thing and measure it.

Work in phases. **Stop after each phase, run the checks, and report before continuing.** Do not build all of it and then test.

---

## What you are building

Members, trainers and staff check into the gym by scanning a QR code displayed on a tablet at the front desk. The QR rotates every 30 seconds so it cannot be used from off-site. Members get a small login of their own to check in, see their plan and see their receipts. The owner gets a check-ins log and a follow-up list.

`CHECKIN-PLAN.md` has the full architecture. The requirements below are **additions and changes to that plan** based on a later client conversation. Where they conflict with the plan, **these win**.

---

## Changed requirements — these override CHECKIN-PLAN.md

### 1. Member login is application number + phone number only

**No PIN. No OTP. No password.** The member types their application number and their phone number. If both match an active member row, they are in.

- Both values are set by the owner/staff when the member is added
- Session persists so a returning member does not retype every visit
- The plan's §4 describes a 4-digit PIN — **remove that entirely**

> **Because there is no second factor, application numbers must not be guessable.** Do not use a plain incrementing counter. Use a per-gym sequence combined with a short random component, e.g. `SC-0007-4K2`. A predictable number plus a phone number that half the neighbourhood knows is not a credential.

Add rate limiting on failed login attempts.

### 2. Application numbers are generated automatically

Today `application_number` is a manual optional text field that appears only in the **edit** member modal (`#e-appnum` in `member-modals.js`). Change this:

- Generated automatically when a member is added — never typed
- Unique per gym (the unique index already exists)
- Shown prominently on the member row and in the member detail view
- The edit field becomes read-only; add a deliberate "regenerate" action for the rare case where a number must be reissued

### 3. "Added by" on the add-member form

New field on the add-member form: a dropdown listing the gym's active staff, sourced from the existing `staff` table.

- Stored on the member row
- Shown in the member detail view
- Shown as a column or filter in the members list, so the owner can see who signed up whom
- Handle the case where the staff member is later deactivated — keep the name, don't blank it out

### 4. Send credentials by WhatsApp

After a member is added, the success state offers **"Send login details"**. It opens WhatsApp with a pre-filled message to that member's number containing their application number, the login link, and a short instruction.

Mirror the existing WhatsApp pattern in `member-modals.js` (around lines 1730 and 1818) — same `wa.me` approach, same escaping. Make the message body an editable template in Gym Settings alongside the existing renewal reminder template (`DEFAULT_WA_TEMPLATE` in `state.js`), not a hardcoded string.

Also make this action available later from the member's detail view, for when a member loses the message.

### 5. Both login entrances move into the hamburger menu

The landing page currently has **"Member Login"** as a nav-bar button and **"Staff & owner login"** in the footer. The client wants both inside the burger menu, so the top bar stays clean.

> **Heads up before you do this:** `src/pages/landing.js` carries a deliberate comment (near the `.sc-nav-cta` styles, around line 505 and 658) saying the login was kept *out* of the drawer on purpose, because "signed-up members arrive looking for exactly it." That was a considered decision and you are reversing it at the client's request. **Update that comment to record the new decision and why** — do not silently delete it. This codebase documents its reasoning and you must keep that voice.

Requirements:

- Burger menu contains the section links plus two clearly separated login options: **Member Login** and **Staff & Owner Login**
- The two must be visually distinct from the section links and from each other — a member must never land on the staff login by accident
- Works at every width in the responsive sweep, including 375px
- Keep the footer "Staff & owner login" link as a secondary path

### 6. Check-ins section — two views, not one

The plan describes a live log. The client also wants a follow-up list. Build both as one section:

**View A — Attendance log**
Who checked in, at what time, newest first. Filter by date range. Search by name. Show today by default. Live-updating so the owner's phone reflects the desk without a refresh.

**View B — Not seen recently**
Active, non-expired members who have not checked in for **21 days** (make the threshold configurable in Gym Settings, default 21). For each: name, phone, last visit date, days since. A one-tap WhatsApp follow-up button per row, using an editable template.

This is the section's real business value — it turns attendance data into a call list. Give it equal weight in the UI, not a tab buried behind the log.

Members who have **never** checked in need handling: show them separately or from their join date, and do not let a member who joined yesterday appear on a 21-day follow-up list.

---

## Everything else follows CHECKIN-PLAN.md

Including, and do not skip these:

- The rotating token mechanism (30s rotation, 90s validity, overlapping windows)
- The QR payload is **not a URL** — `SCULPT1:<gym_code>:<token>`
- In-app camera scanning, with `BarcodeDetector` and a lazy-loaded jsQR fallback for iOS
- Expired members are **blocked**, and the denied attempt is still **recorded**
- Staff/trainer scans upsert the existing `staff_attendance` row — first scan sets check-in, second sets check-out
- All dates and times computed in the gym's timezone, never UTC
- The check-in function **returns** a status, never raises — raising rolls back the denied record
- Members never get a `gym_users` row
- Never open the `gyms` table to members — it holds `owner_password` in plaintext
- New narrow RLS policies added alongside existing ones; no existing policy is widened

---

## Hard rules from this codebase

- Every user-typed string through `escHtml()` before it reaches the DOM
- Money and membership logic stays in atomic Postgres functions
- `.is-open` classes, never the `hidden` attribute on anything styled with `display:`
- No static import widening into `landing.js`, `login.js`, or the PDF engine — new heavy dependencies are dynamic imports, and add a test guarding it like the existing PDF-engine test
- `vite.config.js` keeps `base: '/'`
- The `popstate` guard in `src/app.js` stays
- All colour from `src/styles/tokens.css`
- Migrations are idempotent, numbered from 103, never edit an applied one
- Long explanatory comments above non-obvious code, saying *why* — match the surrounding voice
- Windows/PowerShell: `&&` and `$(...)` do not work

---

## Build order

**Phase 1 — Desk display + staff check-in.** Migrations for tokens, check-ins and gym timezone. The desk QR screen. Staff/trainer scanning into `staff_attendance`. No member accounts yet. This proves the whole rotating-QR mechanism end to end using logins that already exist.

**Phase 2 — Member accounts and portal.** Auto application numbers, "added by", the WhatsApp credential send, member login, and the member area (Check In, My Plan, My Receipts, My Visits). This is the phase with the row-level security work. Go slowly here.

**Phase 3 — Check-ins section.** Attendance log, live updates, and the not-seen-in-21-days follow-up list.

**Phase 4 — Landing page.** Move both logins into the burger menu.

---

## Verification — required after every phase

```bash
npm run build
npx playwright test
npm run lint
node scripts/verify-schema.mjs
node scripts/qa-responsive.mjs
node scripts/qa-nav.mjs
```

`npm run lint` has 12 pre-existing errors. Add none.

Then hard-refresh a deep route such as `/dashboard/finance` against `npm run preview` — that failure mode is silent and the build will not catch it.

**Use Playwright to actually look at every screen you build**, at 1600 / 1440 / 1280 / 1024 / 768 / 480 / 390 / 375. Screenshot them. The desk display and the member area are both new surfaces with no existing test coverage, so they need it most.

### Security tests you must write

These matter more than the rest:

1. A logged-in member cannot read another member's row
2. A logged-in member cannot read the `gyms` table
3. A member cannot reach any dashboard route, including by typing the URL
4. An expired member is blocked **and** the denied row is still written
5. A token older than 90 seconds is rejected
6. A replayed token from a previous rotation is rejected
7. Two scans inside 90 minutes create one check-in, not two
8. A staff second scan sets check-out rather than creating a second row
9. A 6am IST check-in lands on the correct local date, not the previous UTC day

---

## Design

Use **ui-ux-pro-max** on every new screen. Three of them are seen by people who are not staff and have never used the app:

- **The member login** — two fields, on a phone, by someone who was sent a WhatsApp message. It must be obvious and forgiving. Handle the wrong-number case gracefully.
- **The member area** — four things only. Check In is the primary action and should be unmissable. This is not a dashboard.
- **The desk display** — seen from two metres away in a bright room. Huge QR, high contrast, nothing else competing. It must look deliberate, not like a debug screen. Show a clear offline state rather than a stale code.

Everything else matches the existing dashboard exactly. Do not introduce a new visual language.

---

## When you finish

Update the docs, so this does not become tribal knowledge:

- `CLAUDE.md` — the member RLS boundary, the return-don't-raise rule, the timezone rule
- `HANDOVER.md` §6 — desk tablet offline behaviour, never put a member in `gym_users`, never open `gyms` to members
- `HANDOVER.md` §9 — new file locations
- `supabase/migrations/README.md` — the new migrations added to the unapplied list

Then give me a short summary of what changed, what still needs running by hand in the Supabase SQL editor, and anything you were unsure about.

**If any instruction here conflicts with something you find in the codebase, stop and ask me rather than guessing.**
