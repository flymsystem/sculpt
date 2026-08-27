# QR Check-in + Member Portal — Implementation Plan

Rotating-QR attendance for members, trainers and staff, plus a minimal
member app. Written against the existing schema and the rules in
`CLAUDE.md` / `HANDOVER.md` §6.

Status: **plan only, nothing built yet.**

---

## 1. Decisions

Settled with the client:

| Question | Answer |
|---|---|
| Does fake check-in matter? | Yes — must be un-spoofable from off-site |
| Device at the desk? | Yes, one tablet/phone can be kept |
| Member accounts? | Yes — receipts + subscription only |
| Member first login | Application number + phone number |
| Existing members to migrate | **None.** Fresh gym, pre-launch |
| Scan method | In-app scanner (member opens app, camera decodes desk QR) |
| Expired member | **Blocked** at the door |

Defaults I have assumed, flag any you want changed:

| Assumption | Default | Why |
|---|---|---|
| Member owes a balance but is not expired | **Allowed in**, portal shows amount due | Blocking a paid-up member over a partial balance causes a counter argument every visit |
| Grace period after expiry | **0 days**, configurable per gym | Client said block; grace is a setting so it can be softened without a deploy |
| Denied attempts | **Recorded** as `status='denied_expired'`, entry still blocked | Becomes the owner's renewal call list |
| Desk tablet identity | **Dedicated staff account**, not the owner's | Tablet sits unattended all day |
| Re-scan window | One check-in per member per **90 minutes** | Stops double-scan noise without blocking a genuine second session |

---

## 2. How the anti-spoofing works

The QR on the desk screen is **not static**. The desk device asks the
server for a fresh token every 30 seconds and re-renders. Each token is
valid for 90 seconds, so the current and previous codes overlap and a
slow scan never fails.

A photograph of the screen is dead within 90 seconds. That is the whole
mechanism, and it is what makes the attendance log trustworthy enough to
argue with a member about.

**The QR payload is deliberately not a URL:**

```
SCULPT1:<gym_code>:<32-hex-token>
```

If someone scans it with their phone's native camera they get an
unhelpful string, not a link they can bookmark. Only the app knows what
to do with it.

---

## 3. Database

Five new migrations, numbered from 103. Every one idempotent, per the
rules in `supabase/migrations/README.md`.

### 103 — gym timezone + member auth link

```sql
ALTER TABLE gyms   ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE gyms   ADD COLUMN IF NOT EXISTS checkin_grace_days int NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE members ADD COLUMN IF NOT EXISTS login_enabled boolean NOT NULL DEFAULT true;
-- UNIQUE(user_id), plus get_my_member_id() and is_gym_member() helpers
```

`get_my_member_id()` mirrors the existing `get_my_gym_id_as_staff()` —
`SECURITY DEFINER`, `STABLE`, `SET search_path = public, pg_temp`.

> **Timezone is not cosmetic.** The server runs UTC and the gym runs
> IST (UTC+5:30). `staff_attendance.date` currently defaults to
> `CURRENT_DATE`, which is the **UTC** date — so a 6am IST check-in
> lands on the previous day's row. Every date and time this feature
> writes must be computed as `(now() AT TIME ZONE g.timezone)`.

### 104 — member row-level security

The careful one. Today **every** policy in the schema is
`gym_id = get_my_gym_id()` — gym-wide. A member granted that would read
every other member's phone, Aadhaar photo and full payment history.

So: **new narrow policies added alongside the existing ones. No existing
policy is widened.**

| Table | Member may |
|---|---|
| `members` | SELECT `WHERE id = get_my_member_id()` — own row only |
| `payment_history` | SELECT `WHERE member_id = get_my_member_id()` |
| `member_addons` | SELECT own |
| `member_checkins` | SELECT own. **No INSERT** — writes go through the RPC only |
| everything else | nothing |

Two hard rules that go into `HANDOVER.md` §6:

> **A member must never get a row in `gym_users`.** That table is what
> `get_my_gym_id()` reads, and a member appearing in it inherits
> gym-wide read access to the entire business.

> **Never add a member SELECT policy on `gyms`.** That table holds
> `owner_password` in plaintext (migration 022, kept per client
> agreement). The member portal gets gym name and logo from a narrow
> `SECURITY DEFINER` function instead — same pattern as
> `public_gym_plans()` in migration 102.

Members don't need `plans` access at all: `plan_name`, `plan_price` and
`plan_duration_months` are already denormalised onto `members`.

### 105 — rotating check-in tokens

```sql
CREATE TABLE checkin_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id     uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_by uuid
);
```

`sculpt_issue_checkin_token()` — owner/staff only. Returns a fresh
`gen_random_bytes(16)` token with `expires_at = now() + 90s`, and
deletes that gym's tokens older than 5 minutes on the way through, so
the table self-cleans and never needs a cron job.

### 106 — check-ins

```sql
CREATE TABLE member_checkins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  local_date    date NOT NULL,          -- computed in gym timezone
  status        text NOT NULL CHECK (status IN ('ok','denied_expired','denied_cancelled','denied_inactive')),
  source        text NOT NULL DEFAULT 'qr' CHECK (source IN ('qr','manual'))
);
CREATE INDEX ON member_checkins (gym_id, checked_in_at DESC);
CREATE INDEX ON member_checkins (member_id, checked_in_at DESC);
CREATE INDEX ON member_checkins (gym_id, local_date) WHERE status = 'ok';
```

**`sculpt_member_checkin(p_token text)`** — `SECURITY DEFINER`, one
transaction, following the same convention as `sculpt_add_member` and
`sculpt_renew_member`:

1. Resolve `auth.uid()` → member. None ⇒ `NOT_A_MEMBER`.
2. Validate token: exists, `expires_at > now()`, gym matches the
   member's gym. Fail ⇒ `INVALID_TOKEN`.
3. Dedupe: an `ok` row for this member inside 90 minutes ⇒ return
   `ALREADY_CHECKED_IN` without inserting.
4. Eligibility: `is_active`, `cancelled_at IS NULL`,
   `expiry_date >= (local date - grace_days)`.
5. Write the row — `ok` or the matching `denied_*` — and **return** a
   status payload.

> **Step 5 must RETURN, never RAISE.** A `RAISE EXCEPTION` rolls the
> transaction back and takes the denied-attempt record with it, which
> silently destroys the renewal list. The client reads the status field
> and renders the refusal; the function itself always succeeds.

**`sculpt_staff_checkin(p_token text)`** — resolves `auth.uid()` via
`staff.user_id`, validates the same token, then upserts today's
`staff_attendance` row using the existing `UNIQUE(staff_id, date)`
constraint:

- no row → insert `status='Present'`, set `check_in`
- row exists, `check_out` empty, >10 min since check-in → set `check_out`
- otherwise no-op

Staff attendance stops being manual data entry. This is a side benefit
the client didn't ask for and should be told about.

### 107 — member portal readers

Narrow `SECURITY DEFINER` projections, modelled exactly on migration
102's `public_gym_plans()`:

- `sculpt_my_membership()` → gym name, gym logo, member name, photo,
  plan name, start, expiry, days remaining, balance due, status
- `sculpt_my_visits(p_limit int)` → own check-in history
- `sculpt_my_receipts()` → invoice number, date, amount, storage path

Each with `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO authenticated;`.

---

## 4. Member accounts

Members have no email in this schema — `email` is nullable, `phone` is
required. So Supabase Auth gets a synthetic identifier derived from the
gym code and application number, and the member never sees it.

**First login:** application number + phone number. Both already exist
on the member row (`application_number` is unique per gym, indexed).
An Edge Function `member-signin` verifies the pair with service-role
access, provisions or finds the auth user, links `members.user_id`, and
returns a real session.

**After that:** a 4-digit PIN the member sets on first login.

**Reset:** owner re-triggers first-login from the member's row in the
dashboard. No email, no SMS, no cost.

Because the member holds a real Supabase session, **row-level security
does the enforcement** rather than application code — which is the only
way this is safe to ship.

---

## 5. Receipts — one existing issue to fix

The `invoices` storage bucket is currently `public = true`
(migration 101), and `src/lib/invoices.js` hands out
`getPublicUrl()` links. **Any member receipt is readable by anyone who
has or guesses the URL**, today, before this feature exists.

That's tolerable while nobody is looking; it stops being tolerable the
moment a member portal lists receipts. Recommended, and cheapest to do
now while the gym has no data:

1. Flip `invoices` to `public = false`.
2. Add a storage policy letting a member read
   `invoices/{gym_id}/{member_id}/*` where the second path segment is
   `get_my_member_id()`.
3. Switch `invoices.js` to `createSignedUrl()` with a long expiry for
   the WhatsApp send path.

**Tradeoff:** signed URLs expire. A WhatsApp receipt link sent today
stops working when its signature lapses. A one-year expiry makes this a
non-issue in practice, but it is a behaviour change worth stating out
loud rather than discovering.

---

## 6. Front end

New modules, all lazy-loaded, `pages/ → lib/` direction preserved:

```
src/lib/checkin.js                     token issue + check-in RPC wrappers
src/lib/member-auth.js                 first login, PIN, session
src/lib/qr.js                          lazy decode (BarcodeDetector → jsQR) + lazy generate

src/pages/member/index.js              portal shell
src/pages/member/login.js              app number + phone → PIN
src/pages/member/scan.js               camera + decode
src/pages/member/receipts.js

src/pages/dashboard/checkin-display.js desk kiosk QR screen. Exit is a
                                        "← Back" button with a confirm dialog
                                        (changed 2026-08-27 from a 3-second
                                        hold, at the client's direction, after
                                        the hold failed live during a demo —
                                        see HANDOVER.md §6 "window._navTo" and
                                        "kiosk exit" entries). A PIN-on-exit /
                                        auto-return-to-kiosk comparison was
                                        presented; the client explicitly chose
                                        the confirm dialog instead. This is a
                                        speed bump against an accidental tap,
                                        not a gate against a deliberate one —
                                        the kiosk's real security still
                                        depends on physical supervision of the
                                        tablet. Client's informed choice, not
                                        an oversight.
src/pages/dashboard/checkins.js        owner: live list, denied list, history
```

`src/app.js` gets two new lazy routes (`member`, `member-login`) beside
the existing three. After sign-in the router branches: a `gym_users` row
→ dashboard; a `members.user_id` match → portal. One PWA, two audiences,
which is the "same application" the client asked for.

Constraints carried over from `CLAUDE.md`:

- **No static import widening** into `landing.js`, `login.js` or the PDF
  engine. The QR decoder and generator are dynamic imports, guarded by a
  test that mirrors the existing PDF-engine lazy-load test.
- `vite.config.js` `manualChunks` gains a `vendor-qr` bucket so the
  decoder doesn't land in `vendor` and get pulled into first paint.
- `escHtml()` on every member name rendered into the check-in list.
- `.is-open`, never the `hidden` attribute.
- All colour from `src/styles/tokens.css`.

### iOS

Safari has **no `BarcodeDetector`**. Android/Chrome does. So `qr.js`
tries the native API and falls back to jsQR (~45 kB, lazy). Camera
access inside an installed iOS PWA works from iOS 14.3, but that gets
verified on a real iPhone before anyone calls this done — the spec and
the device have disagreed before.

---

## 7. Desk display

New dashboard section, full-screen, nothing but the QR and the gym logo:

- polls `sculpt_issue_checkin_token()` every 30s
- keeps the screen awake (Wake Lock API, `visibilitychange` re-acquire)
- shows a visible "offline" state rather than a stale code

> **If the tablet loses internet, rotation stops and check-ins fail
> within 90 seconds.** The fallback is that staff mark a member present
> from the members list (`source='manual'`). This needs saying in
> `HANDOVER.md` before it happens at 7am on a Monday.

---

## 8. Owner views

Answers "the owner can see it in any of his device" — which is already
mostly true, since Supabase is the shared backend.

- New sidebar item **Check-ins**, mapped to the existing `attendance`
  permission key (already `'full'` for both owner and staff, so
  `permissions.js` needs no new key)
- **Today** — live list, newest first, via a Supabase Realtime
  subscription on `member_checkins` so the owner's phone updates without
  a refresh
- **Denied today** — expired members who tried to enter. Highest-intent
  renewal leads the gym will ever get
- Per-member visit history inside the existing member modal
- Monthly check-in report alongside the existing staff attendance report
  in `backup.js`

---

## 9. Tests

Added to the Playwright suite. The first two matter more than the rest:

1. **A member cannot read another member.** Direct Supabase query with a
   member session; must return zero rows.
2. **A member cannot read `gyms`.** Guards the plaintext
   `owner_password`.
3. Expired member is blocked and the denied row is still written.
4. A token older than 90 seconds is rejected.
5. A replayed token from a previous rotation is rejected.
6. Double scan inside 90 minutes creates one row, not two.
7. Staff second scan sets `check_out`, doesn't create a second row.
8. Check-in at 06:00 IST lands on the correct local date.
9. QR modules are not in the initial bundle.

---

## 10. Build order

Each phase is shippable and testable on its own.

| Phase | Contents | Notes |
|---|---|---|
| **1** | Migrations 103, 105, 106 · desk display · staff/trainer check-in | End-to-end provable with the accounts that already exist. No member auth yet |
| **2** | Migrations 104, 107 · member accounts · member portal · member check-in | The RLS phase. Slowest and least negotiable |
| **3** | Owner Check-ins page · Realtime · denied list · monthly report | |
| **4** | Receipts hardening — private bucket + signed URLs | Cheapest now, while there is no data |

---

## 11. Docs to update when this lands

- `CLAUDE.md` — the member RLS boundary, the RETURN-not-RAISE rule, the
  timezone rule
- `HANDOVER.md` §6 — desk tablet offline behaviour, never put a member
  in `gym_users`, never open `gyms` to members
- `HANDOVER.md` §9 — new file locations
- `supabase/migrations/README.md` — 103–107 added to the unapplied list
