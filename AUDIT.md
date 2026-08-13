# Flym — Production Readiness Audit

**Date:** 13 August 2026
**Scope:** `src/`, `supabase/migrations/`, `supabase/functions/`, `index.html`, `public/sw.js`, `vite.config.js`
**Method:** Every file listed above was read. Findings cite `file:line`.
**Status:** Audit only. No code was changed.

---

## How to read this

Each finding has an ID (A1, B3, …) so we can refer to it later. Each one says:

- **What it is** — the technical problem
- **What the gym owner sees** — the actual human experience when it bites
- **Breaks at** — roughly what scale it becomes a problem
- **Fix** — the shape of the solution

Severity:

| Tag | Meaning |
|---|---|
| 🔴 **CRITICAL** | Loses money, corrupts data, exposes data, or makes the app unusable |
| 🟠 **HIGH** | Wrong numbers shown to the owner, or the app becomes painfully slow |
| 🟡 **MEDIUM** | Degraded experience, or a problem that only appears at larger scale |
| 🔵 **LOW** | Polish, consistency, cleanup |

**One thing to understand before reading Section A.** The whole dashboard is built on one idea: *when you log in, download everything, then do all the maths in JavaScript in the browser.* That's `loadData()` in `src/pages/dashboard/index.js:181-253`. It works beautifully at 200 members. At 100,000 members it doesn't just get slow — it starts showing **wrong numbers**, because the download is silently capped. Almost everything in Section A traces back to this one decision.

---

# A. Scale risks

## A1. 🔴 Revenue figures go silently wrong above 1,000 payments

**Where:** `src/lib/members.js:390-403` (`getPaymentHistory`), consumed by
`src/pages/dashboard/finance.js:78`, `src/pages/dashboard/overview.js:23,35`,
`src/pages/dashboard/analytics.js:40-46`, `src/pages/dashboard/backup.js:482,595,624,662,691`

```js
.order('paid_at', { ascending: false })
.limit(1000);
```

Every revenue number in the product is computed by summing this array in JavaScript. The array is hard-capped at the **1,000 most recent payments**.

**What the gym owner sees:** A gym doing 300 payments a month hits the cap after ~3 months. From then on, "This Year" revenue, "All Time" revenue, the P&L report, the GST summary and the year-end summary all show **only the last 1,000 payments' worth of money**. There is no warning, no "showing partial data" note. The number just quietly stops being true. An owner filing GST off the GST Summary report would be filing wrong figures.

This is the single most dangerous bug in the codebase, because it is invisible. Everything looks like it's working.

**Breaks at:** 1,000 lifetime payments per gym — roughly a 100-member gym after one year.

**Fix:** Money must be summed in Postgres, never in the browser. Add an RPC, e.g. `get_revenue_summary(p_gym_id, p_start, p_end)` returning totals, per-mode splits and a monthly series, plus `get_revenue_rows(p_gym_id, p_start, p_end, p_limit, p_offset)` for the drill-down table. Finance/Overview/Analytics/Backup call those instead of summing `S.payHistory`. Needs migration **033**.

---

## A2. 🔴 The "Full Backup" is not a full backup

**Where:** `src/pages/dashboard/backup.js:656-682` (JSON backup), `:685-...` (PDF backup), `:546-566` (members CSV)

The JSON backup is built from `S.members` (capped at 5,000 — see A3) and `getPaymentHistory()` (capped at 1,000 — see A1).

**What the gym owner sees:** They click "JSON Backup", get a file, and believe their business is safe. If they ever need to restore, most of their payment history and — for a large gym — most of their members simply aren't in the file. This is the kind of thing a customer discovers on the worst day of their year.

**Breaks at:** 1,000 payments / 5,000 members. Already broken for any gym over a year old.

**Fix:** Backup exports must paginate against the database directly (`.range()` loops, 1,000 rows at a time), not reuse the in-memory dashboard state. Write rows out incrementally so memory stays flat. Also add an explicit row count to the file and show it in the success toast so the owner can sanity-check it.

---

## A3. 🔴 Members are capped at 5,000 and everything downstream inherits the cap

**Where:** `src/lib/members.js:89-101`

```js
.from('members_with_status').select('*').eq('gym_id', gymId)
.order('join_date', { ascending: false }).limit(5000);
```

`select('*')` on a wide view — every column including `notes`, `member_addons`, `aadhar_number`, `photo_url` — for up to 5,000 rows, on every dashboard load.

**What the gym owner sees:** At 100,000 members this query alone is several hundred megabytes of JSON. On a cheap Android on a 3G connection the dashboard simply never loads — it sits on the spinner until the browser tab is killed by the OS for using too much memory. Even at 5,000 members it's a 10–30 second load on a slow connection, every single time they open the app.

And when a gym crosses 5,000 members, **member 5,001 onwards does not exist** as far as the app is concerned: not in the members list, not in search, not in alerts, not in revenue, not in broadcasts.

**Breaks at:** ~1,500 members for load-time pain; 5,000 members for silent data loss.

**Fix:** This is the big one and it drives most of the phased plan.
1. Select only the columns the list view needs (about 15 of them, not `*`).
2. Server-side pagination — `.range(from, to)` driven by the members page.
3. Server-side search/filter (see A5).
4. Dashboard counts come from an RPC, not from `S.members.length`.

---

## A4. 🟠 Every dashboard number is computed by looping over every member in JavaScript

**Where:** `src/pages/dashboard/overview.js:14-41` and `:242-252`, `:333-348`

Fourteen separate `.filter()` passes over `S.members` to produce the stat cards, plus `computeOverviewTrends()` which runs a 6-iteration inner loop over every member (`overview.js:247-250`), plus `planDist()` which loops again.

Same pattern in `src/pages/dashboard/analytics.js:12-84` — about twenty full-array passes, including a 12-month × N-members nested loop at `:33-46`.

**What the gym owner sees:** On a ₹7,000 Android phone, the Overview page freezes for several seconds after load — taps do nothing, scrolling is stuck. It reads as "the app has crashed". At 100,000 members the main thread is blocked long enough that Chrome offers to kill the page.

**Breaks at:** noticeable at ~3,000 members, unusable at ~20,000.

**Fix:** One RPC — `get_dashboard_stats(p_gym_id)` — returning all the counts, sums and the 6-month trend series as a single JSON object. Postgres does this in milliseconds with the right indexes. The browser then renders numbers it was handed rather than deriving them. Needs migration **033**.

---

## A5. 🟠 Member search filters the whole list in the browser on every keystroke

**Where:** `src/pages/dashboard/members.js:455-491` (`filterTable`), debounced 150ms at `:30-34`

Every keystroke runs `S.members.filter(...)` over the entire array, and for each member calls `memberStatus(m)` (`helpers.js:134-157`), which itself calls `daysLeft()` → `expiryDate()` → date parsing. So it's not one pass over 5,000 members, it's 5,000 date parses per keystroke.

**What the gym owner sees:** Typing a member's name into search is laggy and drops characters. On a slow phone, searching for "Rahul" means five separate multi-second freezes. Staff at the front desk with a member standing in front of them will hate this.

**Breaks at:** ~2,000 members on a cheap phone.

**Fix:** Move search and filters to the database. `ilike` on `full_name`/`phone`/`application_number` with a trigram index, `payment_status`/`expiry_date` as real `WHERE` clauses, `.range()` for the page. The debounce stays; the work moves server-side. Needs migration **033** (trigram index).

---

## A6. 🟠 The Alerts page renders one DOM card per alerting member, with no limit

**Where:** `src/pages/dashboard/alerts.js:19-32` (`getAlertMembers`), `:89` (`list.map(...).join('')`)

No pagination. No cap. Every expired, expiring and payment-due member becomes a card, all built into one `innerHTML` string. Each card contains an avatar, three buttons and a phone link.

**What the gym owner sees:** For a gym with 100,000 members, a realistic 25% expired/due rate means **25,000 cards** injected at once. The tab hangs and then dies. Even at 2,000 members, ~500 cards is a visible multi-second freeze and a page that scrolls badly forever after.

Note also `:50` — `totalDue` sums outstanding across *all* alert members, so the headline "₹X outstanding" is subject to the same 5,000-member cap as A3.

**Breaks at:** ~400 alerting members for jank; ~5,000 for a dead tab.

**Fix:** Paginate the alerts list (the members table already has a working pagination pattern at `members.js:420-434` — reuse it). Longer term, drive it from a server-side query that returns only the current page of alerting members, ordered by urgency.

---

## A7. 🔴 The admin dashboard downloads every member of every gym on the platform

**Where:** `src/lib/admin.js:19-27`

```js
.from('gyms').select(`
  id, gym_code, name, ..., members!members_gym_id_fkey(id)
`)
```

…then counts them in JavaScript at `:44` (`Array.isArray(g.members) ? g.members.length : 0`).

**What you (the admin) see:** With 50 gyms averaging 5,000 members, that's 250,000 rows pulled into your browser to display 50 numbers. At the target scale — even a handful of gyms at 100,000 members — this request will time out or crash the tab. The admin dashboard becomes unopenable, and you lose your ability to support customers.

The irony: `gym_summary` (migration `023_audit_fixes.sql:111-146`) already computes these counts correctly in Postgres, and the code only uses it as a *fallback* when the main query errors.

**Breaks at:** ~20,000 total members across the platform.

**Fix:** Delete the joined-members query. Use `gym_summary` as the primary source, joined to `gyms` for phone/address/email. This is a small, high-value change.

---

## A8. 🟠 The client-side notification sync sends the whole member list through a dedupe pipeline every 15 minutes

**Where:** `src/lib/notifications.js:151-247` (`buildNotificationRows`), `:253-263` (`syncNotifications`),
driven by `src/components/notification-bell.js:251-280` (`runSync`) and `:504` (`setInterval(runSync, 15 min)`)

`buildNotificationRows()` iterates every member and can emit up to 3 rows each (expired/expiring, payment-due, birthday). Those rows are then all sent in **one `upsert`** (`notifications.js:129-132`).

**What the gym owner sees:** At 100,000 members with 20% needing attention, that's a ~20,000-row upsert fired from a phone, every 15 minutes, while the tab is open. The request body is multiple megabytes. On a poor connection it will fail, retry on the next tick, and burn the owner's mobile data continuously in the background. On a good connection it hammers the database with a write storm that RLS has to evaluate row by row.

Two more problems in the same area:

- **The 15-minute timer never stops.** `mountNotificationBell()` sets it at `notification-bell.js:504`. `cleanupNotificationBell()` clears it, but it's only wired to `beforeunload` (`index.js:162-165`) — which iOS Safari frequently does not fire for a backgrounded PWA. The interval can survive and keep firing.
- **Enquiry notifications never fire from the client.** `runSync` passes `S.enquiries` (`notification-bell.js:255`), but `loadData()` in `index.js:188-197` never fetches enquiries — `S.enquiries` is permanently `[]` (set at `index.js:83`). Only the nightly Edge Function generates enquiry notifications.

**Breaks at:** ~2,000 members.

**Fix:** The nightly Edge Function (`generate-notifications`) already does this job correctly and server-side. Remove the client-side generation entirely and let the bell be read-only: fetch, display, mark read. If you want a mid-day refresh, add a lightweight authenticated endpoint that runs the same server logic for one gym. This also fixes B4 (staff can't write notifications) for free.

---

## A9. 🟠 Missing composite indexes — the ones that exist don't match the queries

**Where:** `supabase/migrations/001_initial_schema.sql:130-145`, `004_reminders.sql:11-17`

The indexes are almost all **single-column**. The queries are all **multi-column**. Postgres can't use a `members(gym_id)` index efficiently for `WHERE gym_id = X AND is_active = true ORDER BY join_date DESC` — it will fetch every row for that gym and sort them.

| Query (file) | Needs |
|---|---|
| `members.js:93-98` | `members (gym_id, join_date DESC) WHERE is_active` |
| `members.js:394-400` | `payment_history (gym_id, paid_at DESC)` |
| `members.js:410-417` | same as above (month range) |
| `alerts` / notification generation | `members (gym_id, expiry_date) WHERE is_active AND cancelled_at IS NULL` |
| dues queries | `members (gym_id, payment_status) WHERE is_active AND cancelled_at IS NULL` |
| `expenses.js:22-29, 32-39` | **`expenses` has no index at all** (see below) |
| `staff.js:116-125` | `staff_salary_payments (gym_id, payment_date DESC)` exists ✔ |

**`expenses` has zero indexes.** Grepping every migration for `CREATE INDEX` turns up nothing for the expenses table. Every expense query is a full table scan filtered by `gym_id` — across *all tenants*. One gym's Finance page scans another gym's expenses.

**What the gym owner sees:** Finance and Expenses take several seconds to load, and get slower as *other gyms on the platform* add data — which is a very confusing failure mode to debug.

**Breaks at:** 50,000 total expense rows platform-wide; 20,000 members per gym for the members indexes.

**Fix:** Migration **033** adds the composite and partial indexes above. Use `CREATE INDEX CONCURRENTLY` so it doesn't lock the tables on a live system. This is cheap, low-risk and high-impact — it belongs in Phase 1.

---

## A10. 🟡 Unbounded queries with no `.limit()`

| File:line | Query | Risk |
|---|---|---|
| `src/lib/expenses.js:32-39` | `getAllExpenses` — all expenses, ever | Called by Finance "All Time" and by `loadData` on every dashboard load (`index.js:193`) |
| `src/lib/expenses.js:22-29` | `getExpensesByRange` | "This Year" on a busy gym |
| `src/lib/staff.js:116-126` | `getSalaryPayments` — all payments, all time | Grows forever |
| `src/lib/staff.js:82-92` | `getAttendanceRange` | 50 staff × 365 days = 18k rows for a year report |
| `src/lib/broadcast.js:131-139` | `getBroadcastRecipients` | Up to 5,000 rows, all rendered into one table (`broadcast.js:855`) |
| `src/lib/admin.js:19-27` | see A7 | |

**Fix:** Add explicit limits with an honest "showing first N" note in the UI, or paginate. Never let a query be unbounded just because it's small today.

---

## A11. 🟡 `loadData()` blocks the entire dashboard on six parallel full-table fetches

**Where:** `src/pages/dashboard/index.js:188-197`

`Promise.all` on members + plans + payment history + addon templates + expenses + staff. Nothing renders until *all six* resolve (`:174`).

**What the gym owner sees:** The slowest of six queries determines how long they stare at a spinner. They wanted to look up one member's phone number; they waited for the entire year's expense ledger to download first.

**Fix:** Load only what Overview needs (the stats RPC from A4), render immediately, and lazy-load each section's data when the user navigates to it. Sections already have `showSectionLoading()` (`helpers.js:268-279`) — the skeleton infrastructure exists, it's just unused for the initial load.

---

## A12. 🟡 The broadcast sender will time out and strand paid campaigns

**Where:** `supabase/functions/process-broadcast/index.ts:163-239`

A sequential `for` loop over up to 5,000 recipients, with `await setTimeout(100)` per message (`:238`) plus a WhatsApp API round-trip plus a database `UPDATE` per recipient (`:217-227`).

5,000 recipients × (100ms delay + ~200ms API + ~50ms DB) ≈ **29 minutes**. Supabase Edge Functions have a wall-clock limit far below that.

**What the gym owner sees:** They pay ₹7,500 for a 5,000-person broadcast. Razorpay takes the money. The function dies partway through. The broadcast is stuck on `status = 'sending'` forever, the progress bar never completes, some members got the message and some didn't, and there is no retry and no refund path. This is a money-losing, trust-destroying failure.

**Breaks at:** roughly 400–500 recipients.

**Fix:** Make the function resumable. Process a bounded chunk (say 200 recipients) per invocation, always leave the broadcast in a consistent state, and re-queue via `pg_cron` or a self-invoking pattern until `pending` is empty. `status = 'sending'` with a `started_at` older than N minutes should be treated as resumable, not stuck. Also batch the per-recipient `UPDATE`s.

---

## A13. 🔵 `safeLog` writes an activity row on every mutation, and randomly deletes

**Where:** `src/lib/members.js:424-439`

Fire-and-forget insert on every member add/edit/delete/renew/cancel, plus a 1%-probability `DELETE ... WHERE created_at < 90 days ago` (`:430-438`).

At scale that random delete is a full scan of a large `activity_log` (indexed on `gym_id` and `created_at` separately, not together — see A9), fired from a random user's browser, unpredictably. Meanwhile `cleanup_old_logs()` already exists in `001_initial_schema.sql:366-375` to do exactly this properly.

**Fix:** Delete the random-prune block. Schedule `cleanup_old_logs()` via `pg_cron` (the pattern is already in `032_notification_cron.sql`).

---

# B. Correctness and security

## B1. 🔴 Push notifications are wired up end-to-end but can never appear

**Where:** `public/sw.js` (the whole file) vs `public/sw-push-append.js:14,53`

`public/sw-push-append.js` contains the `push` and `notificationclick` handlers. **Nothing ever appends it to `sw.js`.** `vite.config.js:22-39` only stamps a cache version — it does not concatenate the file. I confirmed the built artifact: `dist/sw.js` contains no `push` handler either.

**What the gym owner sees:** They open the bell, tap "Enable", grant the browser permission, get a green "Push notifications enabled" toast — and then never receive a single notification. The `send-push` Edge Function reports success. The subscription row is in the database. The message is delivered to the device. The service worker has no handler, so it's discarded. Everything reports success and nothing works.

The nightly cron (`032_notification_cron.sql`) and the whole `generate-notifications` push pipeline are dead weight because of one missing build step.

**Fix:** Either (a) extend the existing `flym-sw-version` Vite plugin to concatenate `sw-push-append.js` onto `dist/sw.js` in `closeBundle()`, or (b) simpler and less magic — paste the two handlers into `public/sw.js` and delete `sw-push-append.js`. I'd recommend (b): one file, nothing to forget.

---

## B2. 🔴 The broadcast Edge Function trusts phone numbers sent by the browser

**Where:** `supabase/functions/create-broadcast-order/index.ts:58-120`

The client posts a `recipients` array of `{member_id, member_name, phone}`. The function checks the caller owns the gym (`:65-72`) and that phones look like phones (`:83-86`) — then inserts them verbatim as the send list (`:112-133`).

It never verifies that those `member_id`s belong to that gym, that they're active members, or that they aren't cancelled.

**What this means:** Anyone who can open dev tools on their own gym dashboard can make Flym's WhatsApp Business number send arbitrary text to arbitrary phone numbers. They pay ₹1.50 each, so it isn't theft — but it is **your** WhatsApp Business Account and **your** Meta sender reputation. A single spam run gets the number rate-limited or banned, which takes broadcasts down for every paying gym.

It also means the "cancelled members are excluded from broadcasts" rule is enforced only in the UI (`broadcast.js:225`) and can be bypassed.

**Fix:** Don't accept recipients from the client. Accept a *filter* (`{status: 'expiring', plan_id: ...}` or an explicit `member_ids` array), then resolve names and phone numbers server-side from the `members` table with `gym_id = <verified gym>`, `is_active = true`, `cancelled_at IS NULL`. Recompute the cost from the server-resolved count.

---

## B3. 🔴 Money-changing operations are multi-step and not atomic

**Where:**
- Renewal: `src/pages/dashboard/member-modals.js:1225-1245` — `updateMember()`, then clear `cancelled_at`, then insert `payment_history`
- Add member: `src/lib/members.js:161-214` — insert member, then insert `payment_history`
- Clear balance: `src/lib/members.js:309-350` — read balance, compute, update member, then insert `payment_history`

Each is a sequence of independent network calls from a phone. There is no transaction. The code handles individual failures gracefully (it sets `_paymentRecorded = false` and shows an amber toast), but it cannot handle the case where the phone loses signal, the tab is backgrounded and killed by iOS, or the battery dies **between** the two calls.

**What the gym owner sees:** A member is renewed and their expiry date moves forward, but no payment is recorded. Finance shows less revenue than the cash in the drawer. There is nothing in the UI to detect or repair this — the member looks completely normal. The owner discovers it at month-end when the books don't balance, with no way to find which record is wrong.

Given "cheap Android phones on poor connections", this will happen. Regularly.

**Fix:** One Postgres RPC per money operation, each doing all its writes in a single transaction:
- `renew_member(p_member_id, p_gym_id, p_plan_id, ..., p_amount_paid)` 
- `add_member_with_payment(...)`
- `clear_member_balance(p_member_id, p_gym_id, p_amount, p_mode)`

Either everything commits or nothing does. Needs migration **033**.

---

## B4. 🔴 Clearing a balance has a lost-update race

**Where:** `src/lib/members.js:309-350`

```js
const { data: member } = await supabase.from('members').select('balance_due')...   // read
const newBalance = Math.round((currentBalance - paid) * 100) / 100;                // compute in JS
await supabase.from('members').update({ balance_due: newBalance })...              // write
```

Classic read-modify-write. Two devices doing this concurrently both read the old balance; the second write overwrites the first.

**What the gym owner sees:** A member owes ₹2,000. The owner collects ₹1,000 on their phone; a staff member simultaneously records ₹1,000 at the desk. Both see success. The member's balance shows ₹1,000 remaining instead of ₹0 — and *two* payment rows were inserted, so Finance shows ₹2,000 collected. The books and the member's account now disagree, permanently.

Same class of bug in the renewal flow, which reads member state from the in-memory `S.members` array (`member-modals.js:1063`) — which may be minutes stale.

**Fix:** Fold into the `clear_member_balance` RPC from B3, using an atomic `UPDATE members SET balance_due = balance_due - p_amount WHERE id = ... AND balance_due >= p_amount RETURNING balance_due`. If zero rows come back, the amount exceeded the current balance — reject cleanly.

---

## B5. 🔴 Staff users are locked out of notifications by RLS

**Where:** `supabase/migrations/031_notifications.sql:70-99` and `:126-148`

Every notifications and push_subscriptions policy is scoped with `gym_id = get_my_gym_id()`. But `get_my_gym_id()` (`023_audit_fixes.sql:9-20`) only matches `role = 'owner'`:

```sql
WHERE user_id = auth.uid() AND role = 'owner'
```

For a staff user it returns `NULL`, so `gym_id = NULL` is never true.

**What the staff member sees:** The bell icon is always empty. No badge, ever. `mark_notifications_read` (`031:152-178`) returns 0 for them. Enabling push silently fails the insert. Meanwhile the client-side sync (`notification-bell.js:478`) fires on every staff login and every insert is rejected — a wasted request storm from every staff device.

Migration `030_staff_login_tiers.sql` carefully added staff policies for members, plans, payments, enquiries, expenses, attendance — and then migration 031 forgot the pattern entirely.

**Fix:** Migration **033** replaces the notifications/push policies with `gym_id IN (get_my_gym_id(), get_my_gym_id_as_staff())` — or better, a single `is_my_gym_any_role(uuid)` helper. Also update `mark_notifications_read` to fall back to `get_my_gym_id_as_staff()`.

---

## B6. 🟠 Automated reminders are sent to cancelled and deleted members

**Where:** `supabase/functions/send-reminders/index.ts:76-81`

```sql
.eq('gym_id', gym.id)
.eq('expiry_date', targetStr)
.neq('member_type', 'Trial')
```

No `is_active = true`. No `cancelled_at IS NULL`.

**What the gym owner sees:** A member who quit — and was cancelled or removed — gets a WhatsApp asking them to renew. The gym looks incompetent and, in the worst case, harasses someone who explicitly left. This directly violates the "cancelled members are excluded from notifications" rule the rest of the codebase follows.

Also at `:193`: when the WhatsApp API isn't configured, `sendWhatsAppReminder` returns `true`, so `last_reminder_sent` is stamped as if the message went out. If you later configure the API, those members will never be re-reminded for that cycle.

**Fix:** Add `.eq('is_active', true).is('cancelled_at', null)`. Return `false` from the log-only branch (or don't stamp the tracker when no API is configured). Note `get_due_reminders()` in `007_auto_reminders.sql:126-133` has the same gap — it filters `m.is_active` but not `cancelled_at`.

---

## B7. 🟠 `send-reminders` has no authorization check

**Where:** `supabase/functions/send-reminders/index.ts:27-42`

The handler runs `runReminders()` on any request. There is no `CRON_SECRET` check (unlike `generate-notifications/index.ts:76-80`, which does this correctly), no admin check, and no method check.

**What this means:** Any authenticated Flym user — including a staff member at any gym — can trigger a platform-wide WhatsApp send by POSTing to the function URL, burning your WhatsApp message quota. If the function was deployed with `--no-verify-jwt`, it's open to the internet.

**Fix:** Copy the `x-cron-secret` pattern from `generate-notifications`. Reject anything else with 401.

---

## B8. 🟠 The broadcast cost constant is out of sync with the database default

**Constraint states:** `COST_PER_MSG_PAISE = 150` must be identical in three places.

| Location | Value |
|---|---|
| `src/lib/broadcast.js:8` | `150` ✅ |
| `supabase/functions/create-broadcast-order/index.ts:18` | `150` ✅ |
| `supabase/migrations/025_broadcast.sql:22` — `cost_per_msg_paise int NOT NULL DEFAULT 90` | **90** ❌ |

The Edge Function always writes `150` explicitly (`create-broadcast-order/index.ts:103`), so live broadcasts are charged correctly today. But the default is a landmine: any row inserted without that column records ₹0.90/message, and any future reconciliation or reporting built off the column default will be wrong.

**Fix:** Migration **033**: `ALTER TABLE broadcasts ALTER COLUMN cost_per_msg_paise SET DEFAULT 150;`

---

## B9. 🟠 WhatsApp Cloud API is pinned to v19.0, not v21.0

**Constraint states:** WhatsApp Cloud API stays v21.0.

- `supabase/functions/process-broadcast/index.ts:180` → `graph.facebook.com/v19.0/`
- `supabase/functions/send-reminders/index.ts:161` → `graph.facebook.com/v19.0/`

**What the gym owner sees:** Nothing — until Meta sunsets v19.0, at which point every broadcast and every automated reminder starts failing with an opaque API error, and paid broadcasts fail after payment.

**Fix:** Change both to `v21.0`. Consider a shared `WA_API_VERSION` constant so the next bump is one edit.

---

## B10. 🟠 Secrets hygiene: no `.gitignore`, and `.env.local` is committed

**Where:** repository root

- There is **no `.gitignore` file at all**.
- `.env.local` is tracked in git (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`).
- `node_modules/` (7,000+ files) and `dist/` are also committed.

The three committed values are all *designed* to be public — the anon key is protected by RLS and the VAPID public key is public by definition. So this is not a live breach. But a repository with no `.gitignore` is one careless `git add .` away from committing a service-role key, and that key bypasses **all RLS for every tenant**.

**Fix:** Add a `.gitignore` (`node_modules/`, `dist/`, `.env*`, `!.env.example`), `git rm --cached` the tracked artefacts, and add a committed `.env.example` with empty values. Rotate the anon key at your convenience — not urgent, but cheap.

---

## B11. 🟡 Gym owner passwords are stored in plaintext

**Where:** `supabase/migrations/022_staff_app_number_password.sql:41-48`

```sql
-- Owner password storage (plaintext for admin access per client agreement)
ALTER TABLE gyms ADD COLUMN owner_password text;
```

Read back by the admin dashboard. I'm noting this because it's the highest-consequence item in the schema, not because I think you're unaware: if the database is ever exposed, you hand over working credentials for every gym — and since people reuse passwords, likely their email and bank logins too. Under India's DPDP Act this is also a reportable failure of "reasonable security safeguards".

**What to do:** This is a business decision, not a technical one, and you've made it deliberately. If the driver is "admin needs to help owners who are locked out", the safer equivalent is an admin-triggered password reset (Supabase's `admin.generateLink`) rather than password storage. I'd suggest planning that transition, but I'm not treating it as a blocker.

---

## B12. 🟡 Unescaped user text reaching `innerHTML`

The codebase is genuinely disciplined about `escHtml()` — I checked every interpolation of user-controlled fields. These are the leaks:

| File:line | Problem |
|---|---|
| `src/pages/dashboard/staff.js:619` | `` title: `Edit — ${s.full_name}` `` — staff name unescaped into the modal title |
| `src/pages/admin-dashboard.js:1399` | `value="${existing?.plan_name\|\|''}"` — a `"` in the value breaks out of the attribute |
| `src/pages/admin-dashboard.js:1410` | `value="${existing?.notes\|\|''}"` — same |
| `src/pages/dashboard/member-modals.js` (detail modal, contact block) | `href="tel:${m.phone}"` and `href="mailto:${m.email}"` — unescaped in an attribute |
| `src/pages/dashboard/finance.js:311` | `${cat}` — expense category rendered raw in "Top Expense Categories" |
| `src/pages/dashboard/finance.js:116` | `${modeLabel}` — `payment_mode` rendered raw |
| `src/components/modal.js:38,66` | `${title}` — `openModal` never escapes its title; every caller must remember to |

Practical severity is low: these fields are entered by the gym's own staff, so it's mostly self-XSS. But `finance.js:311` and the `modal.js` title are the ones I'd fix on principle — `addExpense` (`expenses.js:66`) accepts any string via the API even though the UI uses a `<select>`, and a shared component that trusts its input will eventually be handed something untrusted.

**Fix:** Escape at all seven sites. Make `openModal` escape its own title (and give callers an explicit `titleHtml` option if any genuinely need markup).

---

## B13. 🟡 Edge Function ownership checks are inconsistent

- `create-broadcast-order/index.ts:65-72` — the second ownership check queries `gym_users` by `user_id` + `gym_id` but **omits `role = 'owner'`**. A staff member of that gym passes it. (The earlier check at `:47-55` does require owner, so this isn't currently exploitable — but the two checks disagree, which is how bugs get introduced later.)
- `process-broadcast/index.ts:97-104` — same omission, and here there is **no** prior owner check. A staff user can trigger processing of their gym's broadcast.
- `send-push/index.ts:83-91` — deliberately allows any gym member; that's correct for its purpose.
- `create-gym-user/index.js:42-46` — uses `.single()` on `gym_users` filtered only by `user_id`. Since migration 023 removed `UNIQUE(user_id)` to support multi-branch, a multi-branch admin would make this throw. Should be `.eq('role','admin').limit(1).maybeSingle()`.

**Fix:** One shared `assertGymOwner(admin, userId, gymId)` helper used by all of them.

---

## B14. 🟡 CORS is `*` on every Edge Function

**Where:** all five functions, e.g. `create-broadcast-order/index.ts:13-16`

`Access-Control-Allow-Origin: '*'` everywhere. Combined with `Authorization` being accepted, this means any website can invoke your functions with a victim's token if they can get hold of one.

Also `create-broadcast-order` and `process-broadcast` are missing `Access-Control-Allow-Methods` on the preflight — the exact bug that `create-staff-user/index.ts:10-21` documents having already fixed once. Chrome tolerates it in practice; it's a latent "Failed to send a request to the Edge Function" waiting to happen.

**Fix:** Restrict to `https://flym.in` (plus `http://localhost:5173` for dev) and add `Access-Control-Allow-Methods: POST, OPTIONS` to all of them.

---

## B15. 🟡 Error responses use HTTP 400 for everything

**Where:** `create-broadcast-order/index.ts:195-201`, `process-broadcast/index.ts:273-279`, `create-gym-user/index.js:88-93`

Every failure — auth failure, gym mismatch, Razorpay outage, internal crash — returns `400` with the raw `err.message`. Two problems: the client can't distinguish "you did something wrong" from "our payment gateway is down", and internal error strings leak to the browser.

`create-staff-user/index.ts` gets this right (401/402/403/404/409/500 with curated messages). Use it as the template.

---

## B16. 🔵 Analytics "Renewal Rate" is always 0%

**Where:** `src/pages/dashboard/analytics.js:74-84`

```js
return d >= threeMonthsAgo && p.payment_type === 'Renewal';
```

There is no `payment_type` column on `payment_history` — not in migration 001, not in any later migration, and nothing in `src/` ever writes it. The filter always evaluates false.

**What the gym owner sees:** A Pro-tier feature that permanently reports "0% — 0 renewals / N expirations", implying their retention is catastrophic. Actively misleading.

**Fix:** Either add `payment_type` and populate it (the renewal insert at `member-modals.js:1240` already writes `notes: 'Membership renewal'`, so the data exists in a fragile form), or derive renewals as "members with more than one payment row". I'd add the column — migration **033**.

---

## B17. 🔵 `getPaymentsByMonth` and month-boundary maths

**Where:** `src/lib/members.js:406-420`, `src/lib/staff.js:191-201`

```js
const endDate = new Date(y, mo, 0).toISOString().split('T')[0];
```

`toISOString()` converts to UTC. For IST (UTC+5:30) a local-midnight date shifts to the **previous day**, so the last day of the month can be dropped. The codebase already knows about this — `helpers.js:10-23` has `todayLocalISO()`/`localISO()` written specifically to avoid it, and `finance.js:45-52` has a comment explaining the exact bug — but these two call sites weren't updated. Same pattern at `staff.js:31` and `staff.js:137`.

**What the gym owner sees:** Occasional missing payments at month boundaries in monthly reports.

**Fix:** Use `localISO()` from `helpers.js` (or replicate it in `lib/`).

---

# C. UI / UX

Reviewed against the `ui-ux-pro-max` lens, weighted for the real audience: **gym owners on ₹6,000–12,000 Android phones, often on 3G, often one-handed at a reception desk.**

The design system itself is good. `src/styles/tokens.css` is a genuinely well-built three-tier token set — semantic colours, a proper type scale, spacing scale, radii, easings, z-index ladder, full light/dark parity, and a `prefers-reduced-motion` block. The problem is not the system. **The problem is that most of the app doesn't use it.**

## C1. 🔴 The initial download is ~1.6 MB of JavaScript

**Where:** `dist/assets/main-BOtIKHaL.js` is 1,622,190 bytes. `src/lib/invoice-pdf.js:8` statically imports `html2pdf.js`, which is imported by `member-modals.js:12`, which is imported by `index.js:19`, which is imported by `app.js:7`.

`html2pdf.js` bundles `jsPDF` + `html2canvas` — roughly **1 MB on its own**. It is needed only when someone taps "Invoice → Save PDF".

`vite.config.js` has no `manualChunks` and no dynamic imports anywhere in the app, so every route is in one file. The landing page — a marketing page for logged-out visitors — downloads the entire admin dashboard, the PDF engine, and every modal.

**What the gym owner sees:** On a 3G connection, 1.6 MB is 20–40 seconds before anything appears — and on a metered prepaid plan, real money. The service worker caches it after the first visit, but `vite.config.js:26-37` stamps a fresh cache version on every build, so **every deploy makes every user re-download the full 1.6 MB.**

**Fix (in order of value per unit of effort):**
1. `const html2pdf = (await import('html2pdf.js')).default` inside the PDF function — removes ~1 MB from the initial load. This alone is probably the biggest single UX win available in the codebase.
2. Dynamic-import the admin dashboard route (`app.js:8`) — logged-in gym owners never need it.
3. Add `manualChunks` in `vite.config.js` to split vendor from app code so a deploy doesn't invalidate the Supabase client chunk.

## C2. 🟠 479 hardcoded colour values bypass the token system

Counted across `src/**/*.js`:

| File | Hardcoded hex values |
|---|---|
| `attendance-report.js` | 132 |
| `member-modals.js` | 65 |
| `backup.js` | 52 |
| `landing.js` | 43 |
| `verify.js` | 16 |
| `settings.js` | 16 |
| `admin-dashboard.js` | 14 |

Some are legitimate — the PDF/print templates (`backup.js:257-278`, `invoice-pdf.js`) render to paper and must be light-on-white regardless of theme. Those should be a documented, isolated "print palette", not scattered hex.

The rest are not. `attendance-report.js` with 132 hardcoded colours is effectively a second, undocumented theme.

**What the gym owner sees:** Switch to light mode and parts of the app stay dark, or produce dark-grey text on a dark-grey background. Concrete example: `notification-bell.js:557` — `box-shadow: 0 0 0 2px var(--surface-0, #0A0B0F)`. **`--surface-0` does not exist** in `tokens.css` (the real name is `--surface-bg`), so it always falls through to the hardcoded near-black. In light mode the unread badge gets a black halo. `mobile-fixes.css:37` has the same phantom-token bug.

**Fix:** Sweep `--surface-0` → `--surface-bg` first (2 lines, immediate visible fix). Then convert hardcoded colours to tokens file by file, starting with `attendance-report.js`. Quarantine the print palette into one exported constant.

## C3. 🟠 2,000+ inline `style="..."` attributes instead of classes

| File | `style="` occurrences |
|---|---|
| `member-modals.js` | 279 |
| `admin-dashboard.js` | 225 |
| `broadcast.js` | 162 |
| `settings.js` | 142 |
| `staff.js` | 132 |
| `finance.js` | 96 |

This is why visual inconsistency exists: the same conceptual element — a stat card, a table header, a detail row — is hand-styled slightly differently in each of six files. Compare the table header styling in `finance.js:232-235` against `broadcast.js:846-852`; they're meant to be the same thing and they aren't.

It also inflates the HTML string sent to `innerHTML` on every render, which matters on slow devices.

**Fix:** Extract the recurring patterns into `components.css` classes — `.data-table`, `.detail-row`, `.stat-tile`, `.section-card`. Do this opportunistically, one page per phase, not as a big-bang refactor. **This is the kind of change that needs your sign-off before I touch a file — it's the "improve in place vs restructure" line.**

## C4. 🟠 Loading, empty and error states are inconsistent across pages

| State | Where it's done well | Where it's missing |
|---|---|---|
| Loading skeleton | `helpers.js:268-279` (`showSectionLoading`) — good | Only Finance uses it (`finance.js:72-74`). Members, Alerts, Analytics, Plans, Staff render nothing then snap in |
| Empty state | `members.js:298-303`, `alerts.js:84-88`, `overview.js:303` — nice icon + title + guidance | Analytics charts render an empty axis with no explanation; Broadcast history has no empty state |
| Error state | `index.js:235-246` (dashboard-level) and `app.js:314-325` (boot-level) — genuinely good, with retry buttons | Section-level failures mostly `console.warn` and render stale or blank data. `finance.js:79-81` catches a payment-history failure and silently renders **cached** numbers with no indication they're stale |

**What the gym owner sees:** On a flaky connection the Finance page shows yesterday's revenue as if it were today's, with no warning. That's worse than an error message.

**Fix:** Standardise three helpers — `renderLoading(c, title)`, `renderEmpty(c, {icon, title, hint, action})`, `renderError(c, {message, onRetry})` — in `helpers.js`, and use them everywhere. Never render stale financial data without a visible "couldn't refresh — showing last known" banner.

## C5. 🟠 Touch targets below 44px throughout the member table

**Where:** `src/pages/dashboard/members.js:320-375`

Every row action button is `padding:5px 8px` around a 13px SVG — roughly **23×23px**. A member row can show up to seven of them (`:414`), at `gap:3px`.

WCAG 2.5.5 asks for 44×44px. Apple and Google both say the same. The codebase knows this — `dashboard.css:176,226,234,278` correctly sets `min-height:44px` on the topbar buttons.

**What the gym owner sees:** They mean to tap "Send WhatsApp reminder" and hit "Delete member" instead, because the two are 3px apart and both are half the size of a fingertip. On the members table this is a genuinely dangerous mis-tap: **the delete button sits directly beside the reminder button.**

The mobile fallback (`.show-mobile-only` "more" button, `:369-375`) is the right idea but it's *also* 23px, and the full button row is still shown alongside it on mobile (`:56` only reveals the extra button, it doesn't hide the others).

**Fix:** `min-height:44px; min-width:44px` on all row-action buttons, `gap: var(--space-2)`. On screens under 768px, collapse to *one* 44px "⋯" button that opens the action sheet. Put "Remove" last in that sheet, visually separated, in red.

## C6. 🟡 Accessibility gaps

**What's already good** — worth saying, because it's better than most codebases: modals have `role="dialog"`, `aria-modal`, `aria-labelledby`, a working focus trap and focus restoration (`modal.js:17-80`); the members table has `scope="col"`, `role="search"`, `sr-only` labels and `aria-live` pagination (`members.js:107-148`); the notification bell has `aria-expanded`, `aria-haspopup` and keyboard handling (`notification-bell.js:101-106`); `index.html:6` deliberately allows pinch-zoom.

**Gaps:**

1. **Focus rings are barely present.** Only 5 `:focus-visible` rules across all four stylesheets. Buttons, form inputs, links, filter pills and nav items have no visible keyboard focus indicator. Keyboard navigation is possible but invisible.
2. **Colour contrast.** `--text-quaternary: #4B5563` on `--surface-1: #101218` measures about **3.2:1** — below the 4.5:1 WCAG AA minimum for body text. It's used for `.notif-time` (`notification-bell.js:634`), `.notif-empty-sub`, chart month labels (`analytics.js:111,123` at **8px**), and secondary labels throughout. 8px text at 3.2:1 is unreadable for anyone over 40 — which is a lot of gym owners.
3. **Icon-only buttons with colour-only meaning.** Row actions have `aria-label`s (good) but status is conveyed by badge colour alone; the text inside helps, so this is borderline.
4. **The command palette** (`index.js:378-486`) has no `role="dialog"`, no focus trap, and no `aria-activedescendant` for arrow-key navigation.
5. **`role="button" tabindex="0"` on divs** — mini-stats (`overview.js:218`), notification items (`notification-bell.js:179`). They handle Enter/Space correctly, so this works, but `<button>` would be free.

**Fix:** A single `:focus-visible` block in `components.css` covering `button, a, input, select, textarea, [role="button"]`. Lift `--text-quaternary` to ~`#6B7280` in dark and darken it in light. Raise 8px chart labels to `var(--text-xs)` (11px). Add dialog semantics to the command palette.

## C7. 🟡 iOS PWA layout

`mobile-fixes.css` handles this thoughtfully — safe-area insets on the topbar, sidebar, FAB and modals; `100dvh` alongside `100vh`; `viewport-fit=cover` in `index.html:6`. The file's header comment explains exactly why each rule exists, which is excellent.

Remaining issues:

1. **`.topbar` z-index conflict.** `dashboard.css:49` sets `z-index:50` (`--z-topbar`); `mobile-fixes.css:35` overrides it to `500`, which collides with `--z-overlay: 500`. The notification panel sidesteps this by portalling to `<body>` at `z-index:9999` (correct, and well documented at `notification-bell.js:5-33`) — but the next dropdown someone adds will land on this rake.
2. **Phantom token** — `mobile-fixes.css:37` uses `var(--surface-0, ...)`, which doesn't exist (see C2).
3. **The FAB overlaps the last table row.** `.fab` is `position:fixed bottom:20px+safe-area` (`mobile-fixes.css:58-61`). `.app-content` only gets `padding-bottom: safe-bottom + 24px` (`:45`), which is less than the FAB's 48px height. The last member in the list sits under the FAB.
4. **`document.body.style.overflow = 'hidden'`** for the notification backdrop (`notification-bell.js:336`) will cause iOS scroll-position loss. `modal.js` already solved this properly with the `position:fixed` scroll-lock pattern (`_lockScroll`) — the bell should reuse it.

## C8. 🟡 Form validation feedback is ad-hoc

Three different patterns coexist:

- Direct DOM style mutation: `helpers.js:78` sets `this.style.borderColor = 'var(--red)'` and a `title` attribute
- Timed flash: `member-modals.js:1196` sets a red border then clears it after 1,200ms
- Toast only: `expenses-page.js:125` → `showToast('Please select a category','red')` plus `.focus()`

None of them set `aria-invalid`, none associate an error message with the field via `aria-describedby`, and the timed flash means a screen-reader user gets nothing at all. The `title` attribute is not an accessible error mechanism and doesn't appear on touch devices.

**What the gym owner sees:** On a phone, a red border flashes for one second and vanishes, or a toast appears in the corner while their eyes are on the form field. They don't know what's wrong.

**Fix:** One `setFieldError(inputEl, message)` helper — red border (persistent until corrected), an inline `<div class="form-error">` below the field, `aria-invalid="true"` and `aria-describedby` wired up. Clear on `input`.

## C9. 🟡 Dashboard information hierarchy

The Overview page currently presents, in order: an urgent-alerts banner, 4 stat cards, 6 mini-stats, a renewal forecast, recent activity, a chart, plan distribution, and a "Quick Insights" grid with retention/avg-revenue/payment-split/re-engagement plus two more stacked bars.

That's **19+ distinct numbers above the fold-and-a-bit** on a phone, all competing.

Ask what a gym owner actually opens the app to find out, in order:
1. How much money came in today
2. Who needs chasing today
3. Is anything broken

Right now #1 ("Today's Revenue") is a small 17px mini-stat (`overview.js:75`, `miniStat` renders values at `font-size:17px`) while "Total Members" — a number that barely changes day to day — gets a full stat card with a sparkline. The urgent-alerts banner (`:50-65`) is the most valuable element on the page and it's conditional, unstyled by the token system, and buried in an IIFE.

Also: `overview.js:109` — `<span class="section-meta">${Math.min(S.members.length,8)} events</span>` labels the Recent Activity feed with a member count, not an event count. It'll say "8 events" when there are 3.

**Fix:** Promote today's money and today's chasing list to the top as the two hero elements. Demote Quick Insights behind a "More insights" disclosure or move it wholesale into Analytics, where it belongs. Keep the urgent banner but make it a proper tokenised component.

## C10. 🔵 Smaller UI inconsistencies worth a sweep

- **Date formats disagree.** `fmtDate` gives `DD/MM/YYYY` (`helpers.js:195`), `fmtDateShort` gives `13 Aug 2026` (`:206`), and `members.js:404` calls `exp.toLocaleDateString('en-IN')` directly — three formats in one table.
- **Currency formats disagree.** `fmtCurrency` (`helpers.js:211`) vs `fmtCurrencyShort` (`:212`) vs raw `'₹'+n.toLocaleString('en-IN')` inline in `finance.js:217-220` and a dozen other places.
- **`animateCounter` exists** (`helpers.js:280-292`) and is never called.
- **Two toast colour vocabularies** — `showToast(msg, 'green'|'red'|'amber')` uses colour names rather than semantic ones (`success`/`error`/`warning`), so the call sites encode presentation.
- **`.topbar-logout-btn` class is styled** in `dashboard.css:54` but `index.js:117-123` renders the button with a 6-line inline `style` attribute instead, so the class is dead.

---

# D. Architecture and dead code

## D1. 🔴 Roughly 40% of `src/pages/dashboard/` is dead duplicate files

I traced every `import` in the tree from `app.js` down. These files are imported by **nothing**:

| Dead file | Size | Live equivalent |
|---|---|---|
| `src/pages/dashboard/dashboard_member-modals.js` | 90 KB | `member-modals.js` (120 KB) |
| `src/pages/dashboard/dashboard_backup.js` | 41 KB | `backup.js` (54 KB) |
| `src/pages/dashboard/dashboard_overview.js` | 17 KB | `overview.js` |
| `src/pages/dashboard/dashboard_plans.js` | 17 KB | `plans.js` |
| `src/pages/dashboard/dashboard_members.js` | 15 KB | `members.js` |
| `src/pages/dashboard/dashboard_finance.js` | 11 KB | `finance.js` |
| `src/pages/dashboard/alertss.js` | 10 KB | `alerts.js` (note the typo'd name) |
| `src/pages/dashboard/dashboard_index.js` | 8 KB | `index.js` |
| `src/pages/dashboard/dashboard_contact.js` | 8 KB | `contact.js` |
| `src/pages/dashboard/dashboard_sidebar.js` | 8 KB | `sidebar.js` |
| `src/pages/dashboard/dashboard_alerts.js` | 7 KB | `alerts.js` |
| `src/pages/dashboard/app.js` | 11 KB | copy of `src/app.js` with broken relative paths |
| `src/lib/lib-members.js` | 15 KB | `members.js` |
| `src/components/sidebar.js` | 7 KB | `pages/dashboard/sidebar.js` |
| `supabase/functions/process-broadcast/process-broadcast-index.ts` | 11 KB | `index.ts` |
| `supabase/functions/send-reminders/send-reminders-index.ts` | 8 KB | `index.ts` |
| `invoice-preview-SAMPLE.html` | 5 KB | — |

**Total: ~290 KB of source, over 40% of the dashboard directory.**

**Why this matters more than tidiness:** `lib-members.js` is an *older version* of `members.js` with real behavioural differences — its `addMember` falls back to a fake `'local_' + Date.now()` id (`lib-members.js:118`) that breaks the `payment_history` foreign key, which is precisely the production bug the header comment in `members.js:1-18` says was fixed. When someone (human or AI) greps for `getPaymentHistory` they get two hits with different `.limit()` values (1,000 vs 5,000) and no way to tell which is live. Every future fix risks being applied to the corpse.

**Fix:** Delete all of them. Verify with a build first (`npm run build` will fail on a broken import). This is the single highest safety-per-effort change in this document.

## D2. 🔴 `supabase/functions/whatsapp-webhook/` cannot be deployed

**Where:** `supabase/functions/whatsapp-webhook/whatsapp-webhook-index.ts`

Supabase requires the entry point to be `index.ts`. This directory has no `index.ts` — only a misnamed file. `supabase functions deploy whatsapp-webhook` will fail or deploy nothing.

**What this means:** WhatsApp delivery receipts and inbound replies are not being processed. The broadcast detail view checks for `'delivered'` and `'read'` statuses (`broadcast.js:883-884`) that nothing ever sets, so those counts are always 0.

**Fix:** Rename to `index.ts`, review its auth (webhooks need the Meta verify-token challenge and signature verification), deploy.

## D3. 🔴 Five migrations are missing from version control

The migration sequence has holes: **008, 009, 018 (misnamed), 020, 021, 026** are absent.

The `expenses` table, the `invoices` table, the storage buckets, `gyms.gst_percentage` and `plans.is_featured` are all referenced by live code but created by no migration in this repo. `018_enquiries.sql` exists but is named `supabase--migrations--018_enquiries.sql`, which won't sort or apply correctly.

**What this means:** **You cannot rebuild your production database from this repository.** If the Supabase project were lost, the schema could not be reconstructed. The `expenses` table missing from version control is also why nobody noticed it has zero indexes (A9).

**Fix (this is a real disaster-recovery gap, do it early):** Dump the live schema (`supabase db dump --schema public > supabase/migrations/000_baseline_current.sql`), diff it against what the migrations produce, and write a `033` that reconciles the difference. Rename the 018 file. Add a README noting that `000_baseline_current.sql` is the truth and 001-032 are historical.

## D4. 🟠 Modules that have outgrown themselves

| File | Size | Problem |
|---|---|---|
| `member-modals.js` | 120 KB / ~2,000 lines | Add, edit, delete, cancel, renew, detail, WhatsApp, invoice, clear-balance — nine modals, plus invoice HTML generation, in one file |
| `admin-dashboard.js` | 100 KB | The entire admin product in one module |
| `landing.js` | 98 KB | The marketing site as a JS string |
| `staff.js` | 59 KB | Staff CRUD + attendance + salary + login creation |
| `settings.js` | 56 KB | Every settings panel |
| `backup.js` | 54 KB | Ten different export formats |
| `broadcast.js` | 48 KB | Composer + recipient picker + payment + history + detail |

Files this size are hard for anyone to work in safely, and they're the direct cause of C3 (inline styles) and C2 (hardcoded colours) — nobody can see the whole file, so patterns diverge within it.

**I am flagging these, not proposing to split them.** Per your constraints, any restructuring comes to you first. My recommendation would be to split *only* `member-modals.js`, and only along the natural seam (one file per modal, sharing a helpers module), and only after the scale work is done — it's the file most likely to be edited during the RPC migration in B3.

## D5. 🟠 Inconsistent patterns between pages

The same job is done four different ways depending on which page you're on:

| Concern | Approaches in use |
|---|---|
| **Event wiring** | Delegated listener on a container (`members.js:165-186` — best); per-element `addEventListener` in a loop (`alerts.js:98-103`); inline `onclick` calling a window global (`alerts.js:159-161` → `window._renew`); inline `onclick` calling `window._navTo` (`overview.js:63`) |
| **Modal state** | `openModal` with an `onOpen` callback (`member-modals.js`); direct `innerHTML` + manual bind (`enquiries.js`) |
| **Data refresh after write** | Refetch everything and re-nav (`member-modals.js:1241-1244`); refetch just members (`members.js:268`); mutate `S` in place and re-render |
| **Nav handler injection** | Six separate `setNavHandler`/`setStaffNav`/`setSidebarNav` setters wired in `index.js:41-52` |

The window-global pattern is the one I'd retire first. `app.js:166-172` maintains a hardcoded `LEGACY_GLOBALS` list of 18 names to clean up on navigation — if someone adds a new `window._foo` and forgets the list, it leaks between pages. The cleanup registry at `app.js:156-163` is the better mechanism and it's already built; it's just underused.

## D6. 🟡 `dist/` and `node_modules/` are committed

7,266 tracked files, of which ~7,100 are dependencies and build output. This makes `git log`, `git diff`, code search and code review substantially worse, and it means `dist/` in the repo can silently drift from what `npm run build` produces. Covered by the `.gitignore` fix in B10.

## D7. 🔵 Other cleanup

- `src/pages/dashboard/index.js:567` — `const _origRender = renderGymDashboard;` assigned and never used, under a comment saying "Wire up after dashboard renders".
- `src/pages/dashboard/index.js:506` and `:533` — `updateFAB(section)` takes a `section` parameter it never reads; `fabMenuOpen` is written but never read.
- `src/lib/auth.js:78-98` — a three-level fallback chain for "pre-migration environments". You control the database; there is exactly one. This is 20 lines of defensive code for a case that cannot happen, and it silently masks real column errors.
- `supabase/migrations/002_cardio_addon.sql` — `cardio_addon`/`cardio_price` columns are documented as superseded by 005 and no longer written. They're still in `members` and still in every `select('*')`.
- `src/pages/dashboard/state.js:2` — `DEFAULT_WA_TEMPLATE` duplicates the template in `003_gym_settings.sql:12-17` and `send-reminders/index.ts:24-25`. Three copies of one string.

---

# E. Phased plan

Ranked by **(risk to paying customers) × (value)**. Every phase is independently shippable — you can stop after any one of them and be better off than you are now.

I've kept the riskiest structural work late deliberately. Phases 1–3 are almost entirely additive.

---

### Phase 0 — Safety net (half a day, zero user-visible change)

**Do this before anything else.** It makes every later phase safer.

| Item | Files |
|---|---|
| Add `.gitignore`; `git rm --cached` `node_modules/`, `dist/`, `.env.local`; add `.env.example` (B10, D6) | `.gitignore` (new), `.env.example` (new) |
| Delete the 17 dead files (D1) | See table in D1 |
| Dump the live schema to `000_baseline_current.sql`; rename the 018 migration (D3) | `supabase/migrations/` |

**Migration needed:** No (schema dump only — it documents, it doesn't change).

**How you verify:** `npm run build` succeeds. Open the app, click through every page — Overview, Members, Alerts, Enquiries, Broadcast, Staff, Finance, Expenses, Plans, Settings, Backup, Analytics, Contact — and confirm nothing is broken. `git status` shows a clean tree with ~150 tracked files instead of 7,266.

---

### Phase 1 — Stop the bleeding: database indexes + the three worst queries

**Why first:** Highest impact per line changed, and almost no behaviour changes.

| Item | Files |
|---|---|
| Composite + partial indexes for members, payment_history, expenses, notifications (A9) | **Migration 033** |
| Admin dashboard: use `gym_summary`, drop the members join (A7) | `src/lib/admin.js:19-47` |
| `cost_per_msg_paise` default 90 → 150 (B8) | **Migration 033** |
| WhatsApp API v19.0 → v21.0 (B9) | `process-broadcast/index.ts:180`, `send-reminders/index.ts:161` |
| Reminders: exclude cancelled and inactive members (B6) | `send-reminders/index.ts:76-81`, **Migration 033** for `get_due_reminders()` |
| `send-reminders`: add `CRON_SECRET` check (B7) | `send-reminders/index.ts:27-42` |
| Remove the random 1% activity_log prune; schedule `cleanup_old_logs()` (A13) | `src/lib/members.js:429-438`, **Migration 033** |

**Migration needed:** ✅ **033** — indexes (use `CREATE INDEX CONCURRENTLY`), the `cost_per_msg_paise` default, an updated `get_due_reminders()`, and the cron schedule.

**How you verify:**
- In the Supabase SQL editor, run `EXPLAIN ANALYZE` on the members list query before and after. You should see `Index Scan` instead of `Seq Scan`, and the time should drop by an order of magnitude.
- Open the admin dashboard. It should load in under a second and show the same member counts as before.
- Insert a test broadcast row without specifying the cost column; confirm it defaults to 150.
- Cancel a test member whose expiry is exactly `reminder_days` away, run `select * from get_due_reminders()`, and confirm they don't appear.

---

### Phase 2 — Fix the money

**Why second:** These are the bugs that cost real rupees and destroy trust.

| Item | Files |
|---|---|
| Revenue RPCs: `get_revenue_summary()` + paginated `get_revenue_rows()` (A1) | **Migration 033b**, `src/lib/members.js`, `src/pages/dashboard/finance.js` |
| Transactional RPCs: `renew_member`, `add_member_with_payment`, `clear_member_balance` (B3, B4) | **Migration 033b**, `src/lib/members.js:123-350`, `src/pages/dashboard/member-modals.js:1203-1250` |
| `create-broadcast-order`: resolve recipients server-side (B2) | `create-broadcast-order/index.ts:58-133`, `src/pages/dashboard/broadcast.js:501-509` |
| Backup exports: paginate against the DB (A2) | `src/pages/dashboard/backup.js` |
| Month-boundary UTC bug (B17) | `src/lib/members.js:406-420`, `src/lib/staff.js:191-201,31,137` |

**Migration needed:** ✅ **033b** — the revenue and transactional RPCs.

**How you verify:**
- **The revenue test that matters:** in a staging copy, insert 1,500 payment rows across two years. Before the change, "All Time" revenue will be visibly short. After, it must match `SELECT sum(amount) FROM payment_history WHERE gym_id = ...` exactly. Compare the two numbers side by side.
- **The atomicity test:** open the renew modal, turn on Chrome DevTools → Network → Offline, click Renew. The member's expiry must **not** move, and no payment row must exist. Then go back online and retry; both must happen together.
- **The race test:** open the same member's "Clear Balance" in two browser windows. Enter ₹500 in each, submit both. The final balance must be `original − 1000`, and there must be exactly two payment rows.
- **The backup test:** with 1,500 payments in the database, download the JSON backup and count `payment_history` entries in the file. It must be 1,500, not 1,000.

---

### Phase 3 — Make the app fast on a cheap phone

| Item | Files |
|---|---|
| Dynamic-import `html2pdf.js` and the admin route; add `manualChunks` (C1) | `src/lib/invoice-pdf.js:8`, `src/app.js:8`, `vite.config.js` |
| `get_dashboard_stats()` RPC; Overview reads it instead of looping (A4) | **Migration 033c**, `src/pages/dashboard/overview.js:14-41` |
| Server-side member pagination, search and filters (A3, A5) | **Migration 033c** (trigram index), `src/lib/members.js:89-101`, `src/pages/dashboard/members.js:455-491` |
| Paginate the Alerts list (A6) | `src/pages/dashboard/alerts.js` |
| `loadData` loads only what Overview needs; sections lazy-load (A11) | `src/pages/dashboard/index.js:181-253` |
| Add `.limit()` to the unbounded queries (A10) | `src/lib/expenses.js`, `src/lib/staff.js`, `src/lib/broadcast.js` |
| Resumable broadcast processing (A12) | `process-broadcast/index.ts:163-239`, **Migration 033c** for the cron |

**Migration needed:** ✅ **033c** — `get_dashboard_stats()`, `pg_trgm` + the search index, the broadcast-resume cron.

**How you verify:**
- Chrome DevTools → Network → throttle to "Slow 3G", hard-reload the landing page. Initial JS transfer should drop from ~1.6 MB to under 400 KB. Time-to-interactive should go from ~30s to under 8s.
- Seed a staging gym with 50,000 members. Overview must render in under 2 seconds. Typing in member search must feel instant. Alerts must not freeze the tab.
- Create a 1,000-recipient broadcast in test mode (no WhatsApp credentials configured). It must reach `completed` with `sent_count = 1000` across multiple function invocations, not die partway.

---

### Phase 4 — Notifications actually working

| Item | Files |
|---|---|
| Fix the service worker so push notifications display (B1) | `public/sw.js`, delete `public/sw-push-append.js` |
| Notifications + push RLS for staff (B5) | **Migration 033d** |
| Retire client-side notification generation; bell becomes read-only (A8) | `src/lib/notifications.js:141-263`, `src/components/notification-bell.js:251-280,504` |
| Rename and deploy `whatsapp-webhook` (D2) | `supabase/functions/whatsapp-webhook/` |
| Load `S.enquiries` or remove the dead parameter (A8) | `src/pages/dashboard/index.js:188-197` |

**Migration needed:** ✅ **033d** — notifications/push_subscriptions policies and `mark_notifications_read`.

**How you verify:**
- On an Android phone: enable push in the bell, then trigger `generate-notifications` manually (`select public.trigger_generate_notifications();`). A notification must **appear on the lock screen**. Tap it — the app must open on the Alerts section. This has never worked; it is the whole test.
- Log in as a staff user. The bell must show notifications and the unread badge must count down when they're read.
- Confirm the 15-minute upsert storm is gone: open the dashboard, watch the Network tab for 20 minutes, and confirm no large `notifications` POST fires.

---

### Phase 5 — UI/UX consistency

Deliberately last: it's the largest surface area and the lowest risk of losing anyone money.

| Item | Files |
|---|---|
| Fix the `--surface-0` phantom token (C2) | `notification-bell.js:557`, `mobile-fixes.css:37` |
| 44px touch targets on member row actions; mobile action sheet (C5) | `src/pages/dashboard/members.js:320-375`, `components.css` |
| Global `:focus-visible` block; lift `--text-quaternary` contrast; 8px → 11px chart labels (C6) | `components.css`, `tokens.css`, `analytics.js:111,123` |
| Standard `renderLoading` / `renderEmpty` / `renderError` helpers, used everywhere (C4) | `helpers.js`, all section files |
| `setFieldError()` helper with `aria-invalid` + inline messages (C8) | `helpers.js`, all form modals |
| Escape the 7 unescaped interpolations; make `openModal` escape its title (B12) | `staff.js:619`, `admin-dashboard.js:1399,1410`, `member-modals.js`, `finance.js:116,311`, `modal.js:38,66` |
| Hardcoded colours → tokens, file by file, starting with `attendance-report.js` (C2) | `attendance-report.js`, `member-modals.js`, `backup.js`, … |
| Overview information hierarchy: money first, chasing second (C9) | `src/pages/dashboard/overview.js` |
| Fix "N events" label, unify date/currency formatting (C10) | `overview.js:109`, `helpers.js` |
| Restrict Edge Function CORS; consistent HTTP status codes (B14, B15) | all five Edge Functions |
| Add `payment_type` so Renewal Rate works (B16) | **Migration 033e**, `member-modals.js:1240` |

**Migration needed:** ✅ **033e** — `payment_type` column plus a backfill from `notes`.

**How you verify:**
- Toggle light/dark on every page and confirm nothing is unreadable or mis-tinted.
- Tab through the whole app with the keyboard — every interactive element must show a visible focus ring.
- On a real Android phone, tap each member-row action ten times without a mis-tap.
- Run Lighthouse Accessibility on Overview, Members and Finance; target 90+.
- Confirm the Renewal Rate on Analytics shows a real, non-zero number.

---

### Needs your decision before I start

1. **C3 / D4 — inline styles and oversized files.** Extracting 2,000 inline styles into CSS classes, and splitting `member-modals.js`, both cross your "no rewrites, propose restructuring first" line. My recommendation: do the CSS extraction incrementally inside Phase 5 (one page at a time, each independently shippable), and split `member-modals.js` only if Phase 2 proves too painful to land inside it. Either way, I'll come to you with a specific proposal before touching either.

2. **B11 — plaintext owner passwords.** Your call. If you want to move to admin-triggered password resets instead, that's a small, self-contained piece of work I can scope separately.

3. **`html2pdf.js` stays.** Just to be explicit: nothing in this plan adds an npm dependency. The bundle fix in Phase 3 is a dynamic import of a package you already have.

---

## The short version

If you only read one paragraph: the app is well-built for the gym it was designed for and is not yet built for the gym you're selling to. The design system, the RLS model, the modal accessibility and the iOS PWA handling are all better than typical. But **revenue figures go silently wrong past 1,000 payments (A1)**, **backups are incomplete (A2)**, **members vanish past 5,000 (A3)**, **push notifications have never once worked (B1)**, and **a renewal can take a member's money without recording it (B3)**. Those five, plus the indexes in Phase 1, are the difference between software that looks production-grade and software that is.
