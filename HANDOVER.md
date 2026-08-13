# Flym — Handover

**Work covered:** the hotfix for findings 1 and 4, then `AUDIT.md` Phases 0–5.
**Branch:** `master`. Nothing pushed. Nothing deployed. No migration applied.
**Build:** `npm run build` succeeds. Entry JS is now **15 kB**, down from 1,885 kB.

Read `PROGRESS.md` for the full reasoning behind each unit. This document is the
short version plus everything you need to actually ship it.

---

## 1. Commits, newest last

| # | Commit | What it does |
|---|---|---|
| 1 | `04d8e66` | **Money.** Page through all payment history instead of capping at 1,000 rows — every revenue figure in the product was silently too low. Also fixes the UTC month-end bug that dropped the last day of each month. |
| 2 | `7863abd` | **Money.** `clearBalance` becomes a compare-and-swap, so two devices collecting from the same member can't lose a payment. Failed payment writes now warn instead of showing a green tick. |
| 3 | `a8c5894` | **Money.** Add-member, renew and clear-balance become single transactions via **migration 033**, with a fallback so the app works before it's applied. |
| 4 | `1d4c111` | Delete 17 dead duplicate files (~290 KB) after verifying by import specifier that nothing loads them. |
| 5 | `5137799` | Rename the misnamed `018` migration; document the missing-migration gap. |
| 6 | `30a46f3` | **Migration 034** — composite indexes matching real query shapes; `expenses` had none at all. Plus the broadcast cost default, cancelled-member reminder fix, and scheduled log cleanup. |
| 7 | `8c6f6a8` | Admin dashboard counts gyms via `gym_summary` instead of downloading every member of every gym. |
| 8 | `66688b0` | WhatsApp Cloud API pinned to **v21.0** in both senders (was v19.0). |
| 9 | `3b5c7c6` | `send-reminders`: require `CRON_SECRET`, stop messaging cancelled/deleted members, stop falsely stamping "reminded". |
| 10 | `482658f` | **Security.** Broadcast recipients resolved from the database instead of trusting phone numbers posted by the browser. |
| 11 | `dbcd74f` | **Money.** Exports use the complete member and expense sets, not the 5,000-capped dashboard state. |
| 12 | `762d2eb` | Staff salary/join dates use local time, not UTC. |
| 13 | `3cb2bc2` | **Migration 035** — revenue summed in Postgres instead of downloaded to the phone. |
| 14 | `f736533` | Lazy-load routes and the PDF engine; split vendor chunks. **1,885 kB → 15 kB entry.** |
| 15 | `4d5465e` | Paginate the Alerts page (was rendering one card per alerting member, unbounded). |
| 16 | `bef038d` | Bound the attendance, salary and broadcast-recipient queries. |
| 17 | `3f98e58` | **Push notifications now actually display.** The handlers were in a file nothing ever loaded. |
| 18 | `ab37daf` | **Migration 036** — staff can see notifications at all; retire the 15-minute client-side upsert storm. |
| 19 | `5ac5ffd` | Rename `whatsapp-webhook` entry point to `index.ts` so it can be deployed. |
| 20 | `82d0bb0` | Accessibility: focus rings, WCAG-AA contrast, 44px touch targets, remove a phantom design token. |
| 21 | `2f72343` | Escape user text at the five remaining unescaped `innerHTML` sites. |
| 22 | `e45d7ce` | Fix the "N events" label and make the Renewal Rate stat work (it was permanently 0%). |
| 23 | `085646b` | **Money. Migration 037** — broadcasts send in resumable chunks so a paid campaign can't stall forever. |
| 24 | `d106079` | Edge Function status codes; fix the admin lookup that broke for multi-branch users. |

---

## 2. Migrations — run in this order

**None of these have been applied.** They are files only.
Run them in the Supabase SQL editor, one at a time, checking each before moving on.

| Order | File | Safe to apply while live? | Notes |
|---|---|---|---|
| 1 | `033_money_integrity.sql` | ✅ Yes | Adds three functions. Nothing existing is altered. |
| 2 | `034_scale_indexes.sql` | ⚠️ **Read first** | **Must NOT be wrapped in a transaction** — it uses `CREATE INDEX CONCURRENTLY`, which cannot run inside one. There is deliberately no `begin;`/`commit;`. Every statement is idempotent, so if it stops partway just run it again. |
| 3 | `035_revenue_aggregation.sql` | ✅ Yes | Depends on 034's index for speed, not correctness. |
| 4 | `036_notifications_staff_access.sql` | ✅ Yes | Replaces RLS policies on `notifications` and `push_subscriptions`. |
| 5 | `037_broadcast_resume_cron.sql` | ⚠️ **Edit first** | Replace `<PROJECT_REF>` with your Supabase project ref. Requires `CRON_SECRET` set and `process-broadcast` deployed. |

**After 034, always run this:**
```sql
select indexrelid::regclass from pg_index where not indisvalid;
```
Expect **zero rows**. A failed `CONCURRENTLY` build leaves an invalid index that
is never used but still costs write time. If any appear:
`drop index concurrently <name>;`

Each migration file ends with its own copy-pasteable VERIFY block.

**Order matters against the frontend, but only loosely.** Every client change
falls back to previous behaviour when its migration is absent, so you can deploy
the frontend first, the migrations first, or interleave them.

---

## 3. Deploys I did not do

Nothing was deployed. These need you:

```bash
npx supabase functions deploy create-broadcast-order   # commits 10, 24
npx supabase functions deploy process-broadcast        # commits 8, 23
npx supabase functions deploy send-reminders           # commits 8, 9
npx supabase functions deploy create-gym-user          # commit 24
npx supabase functions deploy whatsapp-webhook --no-verify-jwt   # commit 19
```

⚠️ **Before deploying `send-reminders`:** it now requires `CRON_SECRET`. If that
secret isn't set, the function returns 500 and **reminders stop going out**.
`generate-notifications` already needs it, so it is probably set — confirm with
`npx supabase secrets list`. Whatever calls `send-reminders` on a schedule must
now send an `x-cron-secret` header.

The frontend deploys through Cloudflare Pages as normal.

---

## 4. Manual test checklist — most risky first

### 🔴 A. Money (do these before anything else)

1. **Revenue totals didn't move.** Note Finance → **All Time**, **This Year**,
   **This Month** revenue, the payment count and the Cash/Card/Online split.
   Apply migrations 033–035, reload. **Every number must be identical.** If one
   moved, stop and tell me. Cross-check:
   ```sql
   select coalesce(sum(ph.amount),0), count(*)
     from payment_history ph
     join members m on m.id = ph.member_id and m.is_active
    where ph.gym_id = '<gym-id>';
   ```
2. **The 1,000-row cap is gone.** On a gym with more than 1,000 lifetime
   payments, Finance → All Time must now match the SQL above. Before this work
   it was lower.
3. **Renewal is atomic.** Open the renew modal → DevTools → Network → **Offline**
   → Renew. It must fail *and leave the member's expiry unchanged*. Go back
   online, renew again: expiry **and** payment must both appear.
4. **Clear-balance race.** Same member's Clear Balance in **two windows**, ₹500
   each. First succeeds; second must show *"balance was changed on another
   device"* and record **nothing**. Confirm exactly one new payment row.
5. **Rejected payment leaves no trace.**
   `select flym_clear_balance('<member>','<gym>',999999,'Cash');` → error, then
   confirm `balance_due` unchanged and no new `payment_history` row.
6. **Backup is complete.** JSON Backup → count the `members` array against
   `select count(*) from members where gym_id='<gym>' and is_active`.
7. **Broadcast over 150 recipients** (test mode, no WhatsApp credentials): watch
   `sent_count` climb past 150 across invocations and finish `completed`, with
   `sent + failed = total_recipients` and **no** rows left `pending`.
8. **Broadcast charge matches what's sent.** Select 2 members, cancel one in
   another tab, then pay. You must see the amber "can no longer be messaged"
   warning and be charged for **one**.
9. **Month-end payments.** A payment dated the last day of a month must appear
   in that month's payment report and in that staff member's monthly salary total.

### 🟠 B. Security and access

10. **Tenant isolation on the new RPCs.** Logged in as gym A, call
    `flym_clear_balance` with a gym B member id → *"Member not found"*, never success.
11. **Broadcast can't message arbitrary numbers.** Post a `member_ids` array
    containing another gym's member id → excluded from the order.
12. **Staff can't process a broadcast** → 403.
13. **`send-reminders` rejects unauthenticated calls** → 401 with no header, 200
    with the correct `x-cron-secret`.
14. **Cancelled members get no reminders.** Cancel a member expiring in exactly
    `reminder_days` days → absent from `select * from get_due_reminders();`
15. **Staff notifications work** (migration 036). Log in as staff: the bell shows
    notifications and the badge counts down. It was always empty before.
16. **Staff still can't see another gym's data**, and can't see a colleague's
    `push_subscriptions` rows.

### 🟡 C. Things that have never worked

17. **Push notifications.** Deploy, fully close and reopen the app so the new
    service worker activates, enable push, then
    `select public.trigger_generate_notifications();`. **A notification must
    appear on the lock screen.** Tap it — the app opens on the right section.
    (iOS: only works when installed to the Home Screen, iOS 16.4+.)
18. **Renewal Rate** in Analytics shows a real number, not 0%.
19. **WhatsApp delivery receipts** — after deploying the webhook and verifying it
    in the Meta dashboard, broadcast recipients should move to *delivered* / *read*.

### 🟢 D. Regression sweep

20. **Every page loads:** Overview, Members, Enquiries, Alerts, Broadcast, Staff,
    Finance, Expenses, Plans, Plans Showcase, Gym Settings, Data & Backup,
    Analytics, Contact. (17 files were deleted — this is the check that matters.)
21. **Every export runs:** Members CSV/PDF, Payments, Year-End, Outstanding, P&L,
    GST, Expenses CSV, JSON Backup, Full PDF Backup. Four handlers became `async`.
22. **PDF is lazy:** open an invoice → Print/PDF, and confirm `vendor-pdf`
    downloads **at that moment** in the Network tab, and the PDF renders.
23. **Offline behaviour:** load, go offline, hard-reload → "Couldn't load this
    page / Refresh", **not** a blank screen.
24. **Alerts pagination:** pager appears past 50 alerts; the four stat cards and
    Total Outstanding still count **all** alerts, not the page.
25. **Both themes** on every page — the contrast token changed, so small grey
    text looks different by design.
26. **Keyboard:** Tab through Members, Finance and a modal — every focused
    control shows a visible ring.
27. **Touch targets on a real phone:** tap "Send reminder" ten times in the member
    table without hitting "Remove".
28. **Notification storm is gone:** leave the dashboard open 20 minutes; no large
    POST to `notifications` in the Network tab.

---

## 5. Anything that could affect money — and how to check it

Seven commits touch money. In rough order of "check this first":

| Change | Risk if I got it wrong | Check |
|---|---|---|
| Payment history paging (`04d8e66`) | Revenue too high (double-counted rows) or too low | Test A1 + A2. The `(paid_at DESC, id DESC)` tiebreaker is what prevents duplicates across pages — if totals are *higher* than the SQL, that's the thing to suspect |
| Revenue RPCs (`3cb2bc2`) | Totals shift because server and client disagree on period boundaries | Test A1. Boundaries are computed client-side and passed in specifically to make this impossible, but verify |
| Transactional RPCs (`a8c5894`) | A payment silently not recorded, or recorded twice | Tests A3, A5. The fallback only triggers on "function not found" — a rejected payment is never retried down the non-atomic path |
| clearBalance CAS (`7863abd`) | A legitimate payment refused as a false conflict | Test A4, then collect a normal balance and confirm it works first time |
| Broadcast recipient resolution (`482658f`) | Owner charged for the wrong number of messages | Test A8. Cost is computed from the server-resolved count |
| Resumable broadcast (`085646b`) | Same member messaged twice = double charge to your Meta account | Test A7 — the status counts must sum to exactly `total_recipients` |
| Backup completeness (`dbcd74f`) | Under-reported figures in the year-end/P&L/GST reports | Test A6, then compare a year-end summary against the SQL total |
| Staff date fixes (`762d2eb`) | A salary lands in the wrong month | Test A9 |
| `cost_per_msg_paise` default 90 → 150 (`30a46f3`) | Was only a latent risk — the Edge Function always wrote 150 explicitly, so live billing was already correct | `select column_default …` = 150 |

**The single most important test is A1.** If revenue is identical before and
after, the money work is sound.

---

## 6. What I did not do, and why

### Needs your decision

1. **Members data flow — server-side pagination and search (`AUDIT.md` A3, A5, A4, A11).**
   This is the biggest remaining scale item and the one I deliberately stopped on.
   `getMembers()` still caps at 5,000, and Overview still derives its numbers by
   looping over that array.
   **Why I stopped:** ~8 modules assume `S.members` is *the complete list* —
   `member-modals.js` alone does `S.members.find(...)` in a dozen places. Making
   it one page changes a contract the whole dashboard depends on. That is the
   restructuring you asked me to propose rather than do.
   **What I'd propose:** a `get_dashboard_stats(gym_id)` RPC for the counts, a
   paged+searched member query, and a small `memberById()` lookup helper to
   replace the `S.members.find` calls so modals fetch a member they don't have.
   Roughly one migration and touching six files. Say the word and I'll write it
   up properly first.
   *Partially mitigated already:* Alerts is paginated, exports read the full set,
   and the members table already pages client-side.

2. **CORS origin restriction (`AUDIT.md` B14).** Still `*`. Practical risk is low
   (tokens are in localStorage, not cookies, so another site can't ride the
   session), but a wrong origin list breaks every Edge Function for every user
   and I can't test a deploy. **Tell me your production and preview origins** and
   it's a one-line change per function.

3. **Plaintext owner passwords (`AUDIT.md` B11).** Untouched — you flagged this as
   a deliberate business decision. If you want to move to admin-triggered
   password resets instead, that's a small self-contained piece of work.

4. **`x-hub-signature-256` on the WhatsApp webhook.** The verify-token handshake
   is correct, but the webhook doesn't verify Meta's signature, so anyone who
   learns the URL can POST fake delivery receipts. Low impact. Not added because
   it changes behaviour on a function that has never run.

5. **`.env.local` is still tracked in git.** Your `.gitignore` doesn't affect an
   already-tracked file. I didn't untrack it because I can't verify whether your
   Cloudflare Pages build reads it — **if it does, removing it ships an app with
   no Supabase URL, which is a total outage.** The three values are public by
   design so there's no live exposure. Confirm the vars are set in the Cloudflare
   dashboard, then `git rm --cached .env.local`.

### Needs database access, which I don't have

6. **The baseline schema dump (`AUDIT.md` D3).** Migrations 008, 009, 020, 021,
   026 are missing from version control, and the `expenses` table, `invoices`
   table, `gyms.gst_percentage`, `plans.is_featured` and the storage buckets are
   created by **no migration in this repo**. *This repository cannot rebuild your
   database.* That's a real disaster-recovery gap. Run:
   ```bash
   npx supabase db dump --schema public > supabase/migrations/000_baseline_current.sql
   ```
   Commit it and tell me — I'll diff it against what the numbered migrations
   produce so we can see exactly what drifted.

### Deferred UI work (`AUDIT.md` Phase 5 remainder)

7. **Standard loading / empty / error components (C4).** Only Finance uses the
   skeleton helper. Worse, a failed refresh in Finance renders **stale cached
   numbers with no warning** — I'd fix that one first.
8. **Form validation feedback (C8).** Three different patterns, none setting
   `aria-invalid`, one that flashes a red border for 1.2 seconds and vanishes.
9. **~2,000 inline styles → CSS classes (C3)** and **479 hardcoded colours (C2)**.
   `attendance-report.js` alone has 132 hardcoded colours — effectively a second
   undocumented theme. This crosses the restructuring line; needs your sign-off.
10. **Dashboard information hierarchy (C9).** 19+ numbers compete above the fold;
    "Today's Revenue" — the thing owners actually open the app for — is a 17px
    mini-stat while "Total Members" gets a full card with a sparkline.
11. **Date and currency formatting (C10).** Three date formats in one table.

---

## 7. Things I was unsure about — please check

1. **`members.member_addons` column type.** It's `jsonb` if migration 011 was
   applied, `text` otherwise, and with 008/009/020/021/026 missing from the repo
   I couldn't tell which your live database has — and I wasn't going to query it.
   I sidestepped it: migration 033 takes the value as `text` and lets Postgres
   assignment-cast it, which is byte-for-byte what PostgREST already does, so the
   stored value is identical either way.

   **But there may be a live bug here worth checking separately.** If the column
   *is* `jsonb`, then `parseMemberAddons()` in `helpers.js:103` calls
   `JSON.parse()` on a value supabase-js already returned as a real array — that
   throws, and it silently returns `[]`. Which would mean **member add-ons never
   render anywhere**. **Please open a member who has add-ons and tell me whether
   they show.** It changes what the right fix is.

2. **Whether `CRON_SECRET` is currently set.** Deploying `send-reminders` without
   it stops reminders. Please confirm before deploying.

3. **The pre-existing ESLint errors.** There were 4 unused-variable errors in
   `member-modals.js` and a few in `overview.js`/`staff.js` before I started. I
   left them alone rather than mixing unrelated cleanup into these commits. Only
   one lint error was mine and I fixed it in the same commit.

4. **I could not run the app.** Everything here is verified by `npm run build`,
   ESLint, reading the code, and inspecting the built bundle. **No behaviour was
   verified in a browser.** That's what the checklist in section 4 is for, and
   it's why I kept every risky change behind a fallback.
