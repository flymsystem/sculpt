# Flym — Work Log

Running log of every unit of work, newest at the bottom.
Each entry: what changed, why, which files, and what to click to verify.

Companion documents: `AUDIT.md` (the findings), `HANDOVER.md` (written at the end).

---

## Migration numbering

`AUDIT.md` allocated 033–033e. The hotfix work needs 033 first, so everything
after it shifts up. The real numbering is:

| Migration | Belongs to |
|---|---|
| `033_money_integrity.sql` | Hotfix — transactional money RPCs |
| `034_*` | Phase 1 — indexes and defaults |
| `035_*` | Phase 2 — revenue aggregation |
| … | assigned as each phase lands |

**No migration in this repo has been applied to the live database.** They are
files only. `HANDOVER.md` lists the order to run them in.

---

## HOTFIX 1 — payment history no longer truncated at 1,000 rows

**Commit:** `fix(money): page through all payment history instead of capping at 1000 rows`

### Why

`AUDIT.md` finding **A1**. `getPaymentHistory()` ended with `.limit(1000)`.
Every revenue number in the product is a JavaScript sum over the array it
returns — Finance, Overview's "This Month"/"Today's Revenue", Analytics'
12-month revenue trend, the P&L report, the GST Summary, the year-end summary
and the JSON/PDF backups.

That `.limit()` did not truncate a list. It truncated **money**. A gym past
1,000 lifetime payments was being shown revenue totals that were simply too
low, with nothing in the UI to say so.

### What changed

`src/lib/members.js`

- Added `fetchAllPayments()`, a private helper that pages through the full
  result set 1,000 rows at a time using `.range()` instead of capping.
- `getPaymentHistory()` and `getPaymentsByMonth()` both go through it.
- **Stable sort added.** Paging needs a total order. `paid_at` alone is not
  unique — `addMember` stamps every payment at noon of the member's join date,
  so members added on the same day share a timestamp *exactly*. Without a
  tiebreaker, rows shuffle between pages and the total comes out wrong in both
  directions (some rows counted twice, others skipped). Both queries now order
  by `paid_at DESC, id DESC`.
- **The ceiling is now honest.** There is still a hard stop at 100,000 rows so
  a runaway query can't hang a phone, but if it is ever hit the returned array
  carries `_truncated = true` and a console warning fires, instead of silently
  under-reporting.

### One extra fix inside the same function — flagging it explicitly

`getPaymentsByMonth()` computed its month-end date with
`new Date(y, mo, 0).toISOString().split('T')[0]`. `toISOString()` converts to
UTC, and for IST (UTC+5:30) that shifts local midnight back to the previous
day — so **the last day of every month was excluded** from monthly payment
reports. That is `AUDIT.md` finding **B17**.

I fixed it here rather than leaving a known money bug inside a function I was
already rewriting. It is four lines and it is in the diff for this commit, not
hidden in a later one.

### Not fixed by this commit

This makes the numbers **correct**. It does not make them **fast** — a gym with
50,000 payments now downloads 50,000 rows to add them up. That is Phase 2,
which moves the summation into Postgres. Correctness first.

### How to verify

1. Open **Finance**. Click through **Today / This Week / This Month / Last
   Month / This Year / All Time**. Every figure should still look sane and
   nothing should error.
2. The real test needs a gym with **more than 1,000 lifetime payments**. On
   such a gym, compare Finance → **All Time** → Revenue against the truth:
   ```sql
   select sum(ph.amount)
   from payment_history ph
   join members m on m.id = ph.member_id
   where ph.gym_id = '<gym-id>' and m.is_active = true;
   ```
   These two numbers must now match exactly. Before this commit the app's
   number was lower.
3. Open the browser console (F12) while Finance loads. You should see **no**
   `payment history hit the ... ceiling` warning. If you do, tell me — that gym
   has over 100,000 payments and needs Phase 2 sooner.
4. **Month-end check:** find a payment dated on the **last day** of a month.
   Go to **Data & Backup → monthly payment report** for that month. That
   payment must now appear. Before this commit it was missing.
5. Watch the Network tab on the Finance page. You should now see one or more
   `payment_history` requests with a `Range` header, not a single capped one.

---

## HOTFIX 2 — clearBalance no longer loses concurrent payments

**Commit:** `fix(money): make clearBalance a compare-and-swap and surface failed payment writes`

### Why

`AUDIT.md` finding **B4**. `clearBalance()` was read → compute in JavaScript →
write:

```js
const { data: member } = await supabase.from('members').select('balance_due')…
const newBalance = currentBalance - paid;
await supabase.from('members').update({ balance_due: newBalance })…
```

Two devices collecting against the same member both read the old balance, and
the second write silently overwrites the first.

**What that looks like in the gym:** a member owes ₹2,000. The owner takes
₹1,000 on their phone while a staff member records ₹1,000 at the desk. Both see
a green success toast. The member's balance shows **₹1,000 still owing instead
of ₹0** — but *both* payment rows landed, so Finance shows ₹2,000 collected. The
books and the member's account now disagree and nothing flags it.

Second problem in the same function: the `payment_history` insert logged its
error to the console and carried on. The user got a green "payment recorded!"
toast for a payment that was never recorded.

### What changed

`src/lib/members.js` — `clearBalance()`

- The update is now **conditional on the balance we actually read**
  (`.eq('balance_due', rawBalance)`). If anyone changed the row in between, zero
  rows match, and the function throws a plain-English error instead of
  clobbering: *"This member's balance was changed on another device just now…
  no payment has been recorded."*
- The raw column value is passed to the comparison, not the parsed float, so JS
  number formatting can't drift from the stored `NUMERIC`.
- Handles legacy rows where `balance_due` is `NULL` (uses `.is()` not `.eq()`).
- Zero matched rows is treated as a genuine conflict, not a possible
  RLS-blocked-select-back. That is safe to assume here: the `SELECT` at the top
  of the same function already succeeded for this user on this exact row, so
  reads are demonstrably permitted.
- Returns `_paymentRecorded` alongside the row, matching the flag `addMember()`
  already used.

`src/pages/dashboard/member-modals.js` — clear-balance modal

- On `_paymentRecorded === false`, shows an amber warning
  (*"Balance updated, but the ₹X payment did NOT save to Finance — record it
  manually"*) instead of a green success.

### Deliberately not done here

This makes the balance update **safe**, not **atomic**. The balance write and
the payment-history write are still two separate requests, so a phone that dies
between them still leaves them out of step — just with a visible warning now
instead of silence. True atomicity needs a transaction, which needs a migration;
that is the next unit.

### How to verify

1. **Normal path.** Open a member with a balance due → **Clear Balance** → enter
   part of the balance → confirm. Balance drops by that amount, status becomes
   `Partial`, and the payment shows in **Finance → Revenue** breakdown. Clear the
   rest — status becomes `Paid`.
2. **The race, which is the point of this commit.** Open the *same* member's
   Clear Balance modal in **two browser windows** side by side. Enter ₹500 in
   each. Submit the first — it succeeds. Submit the second — it must now show a
   red error saying the balance changed on another device, and must **not**
   record a payment. Before this commit both succeeded and the books went wrong.
3. Confirm the failed second attempt left **exactly one** new row in Finance,
   not two.
4. **Over-payment guard still works.** Try to clear more than the balance due —
   still rejected with the existing message.

---

## HOTFIX 3 — add / renew / clear-balance are now single transactions

**Commit:** `fix(money): make add-member, renew and clear-balance atomic via migration 033 RPCs`
**Migration added:** `supabase/migrations/033_money_integrity.sql` — **not applied, file only**

### Why

`AUDIT.md` finding **B3**. Each of these operations was two or three
independent HTTP writes from the phone:

```
add    : INSERT members            → INSERT payment_history
renew  : UPDATE members            → clear cancelled_at → INSERT payment_history
clear  : SELECT + UPDATE members   → INSERT payment_history
```

There is no transaction across separate HTTP requests. On a cheap Android on a
weak connection — the entire target market — the first write lands and the
second doesn't. **The membership moves forward and the money disappears.**

Nothing in the app can detect it afterwards, because the member record looks
completely normal. The owner finds out at month end when Finance doesn't match
the cash in the drawer, with no way to tell which record is wrong.

### What changed

**`supabase/migrations/033_money_integrity.sql` (new, not applied)**

Three functions — `flym_clear_balance`, `flym_renew_member`, `flym_add_member`.
A function body is one transaction, so every write inside it commits together
or not at all. `flym_clear_balance` also takes `SELECT … FOR UPDATE` on the
member row, which serialises two staff collecting from the same member.

They are **not** `SECURITY DEFINER`, deliberately. They run as the calling user,
so the existing RLS policies apply unchanged and no new privilege or bypass is
created. A `SECURITY DEFINER` version would have had to re-implement
owner/staff/admin authorisation by hand, and any mistake there is a
cross-tenant data leak.

`p_member_addons` is typed `text`, not `jsonb`, on purpose — see the note below.

**`src/lib/members.js`**

- `clearBalance()` and `addMember()` now call their RPC first.
- New `renewMember()` holds the renewal logic (it had been inline in the modal,
  which is why the RPC needed a home in the lib).
- `isMissingFunction()` — each RPC call falls back to the **old multi-step path**
  only when the error means "migration 033 isn't applied here yet"
  (`PGRST202` / `42883`). Any other error — a validation failure, an RLS
  refusal, a network drop — is thrown. This matters: silently retrying a
  *rejected* payment down the non-atomic path could double-record it.

**`src/pages/dashboard/member-modals.js`**

- The renew handler now calls `renewMember()` instead of doing the three writes
  itself. Its amber "renewed but payment record failed" warning still works, and
  is now only reachable on the pre-033 fallback path.

### This is safe to deploy before the migration runs

Nothing breaks if you deploy the frontend and never apply 033 — every path
falls back to exactly what it did before (plus hotfix 2's compare-and-swap).
Apply the migration and the same code becomes atomic with no redeploy. The two
can happen in either order.

### Something I was unsure about — please read

The `members.member_addons` column is `jsonb` **if migration 011 was applied**,
and `text` otherwise. Migrations 008, 009, 020, 021 and 026 are missing from
this repo (`AUDIT.md` D3), so I can't tell which your live database has, and I
was not going to query it to find out.

I sidestepped it: the RPC takes `member_addons` as `text` and assigns it to the
column, letting Postgres assignment-cast it. That is byte-for-byte what
PostgREST already does today, so the stored value is identical either way.

Related, and worth checking separately: if the column **is** `jsonb`,
`parseMemberAddons()` in `helpers.js:103` does `JSON.parse()` on a value that
supabase-js already returned as a real array, which throws and silently yields
`[]`. That would mean member add-ons never render anywhere. I have not touched
it — **please check whether add-ons currently display on a member with add-ons**,
and tell me, because it changes what the right fix is.

### How to verify

**Before applying migration 033** (proves the fallback is intact):

1. Add a member with a payment → member appears, payment appears in Finance.
2. Renew a member → expiry moves, payment appears in Finance.
3. Clear a balance → balance drops, payment appears in Finance.
   All three should behave exactly as they did yesterday.

**Then apply `033_money_integrity.sql`** in the Supabase SQL editor and repeat
1–3. Same results, now atomic. Then the tests that actually prove it:

4. **Atomicity.** Open the renew modal, DevTools → Network → **Offline**, click
   Renew. It must fail with an error, and the member's expiry must be
   **unchanged** — check the members table. Go back online, renew again;
   expiry *and* payment must both appear together.
5. **Rejected payment leaves nothing.** In the SQL editor:
   ```sql
   select flym_clear_balance('<member-id>', '<gym-id>', 999999, 'Cash');
   ```
   Expect *"Amount cannot exceed the balance due"*. Then confirm `balance_due`
   is unchanged **and** no new `payment_history` row exists.
6. **Tenant isolation.** Logged in as one gym, call `flym_clear_balance` with
   another gym's member id. Must fail with *"Member not found, or you do not
   have access to them."* — not succeed.
7. **Trial members still record no joining payment.** Add a Trial member; no
   `payment_history` row should be created.
8. **Renewing a cancelled member un-cancels them** and records the payment.

---

## PHASE 0a — delete 17 dead files

**Commit:** `chore: delete 17 dead duplicate files (~290 KB) that nothing imports`

### Why

`AUDIT.md` finding **D1**. Roughly 40% of `src/pages/dashboard/` was stale
duplicates — `dashboard_members.js` beside `members.js`, `alertss.js` beside
`alerts.js`, and so on.

This is not tidiness. `src/lib/lib-members.js` was an **older version of
`members.js` with real behavioural differences** — its `addMember` fell back to
a fake `'local_' + Date.now()` id that breaks the `payment_history` foreign
key, which is precisely the production bug the header comment in `members.js`
says was fixed. Two files exported `getPaymentHistory` with *different* row
caps (1,000 vs 5,000).

I hit this myself during the hotfix: searching for the payment cap returned two
results and I had to trace the import graph to know which one was live. Every
future fix — mine or yours — risks being applied to the corpse.

### How I verified they were safe to delete

Rather than trusting filenames, I checked actual import specifiers. Two
initially looked referenced and were false positives:

- `src/pages/dashboard/app.js` — the hits were `'/src/app.js'` and
  `'../../app.js'`, which both resolve to **`src/app.js`**, a different file.
- `src/components/sidebar.js` — the hits were `'./sidebar.js'` from inside
  `src/pages/dashboard/`, which resolves to **`src/pages/dashboard/sidebar.js`**.

The build then confirmed it: **102 modules transformed, exactly the same count
as before the deletion.** None of these files were ever in the bundle.

### Files deleted

`dashboard_member-modals.js`, `dashboard_backup.js`, `dashboard_overview.js`,
`dashboard_plans.js`, `dashboard_members.js`, `dashboard_finance.js`,
`dashboard_index.js`, `dashboard_contact.js`, `dashboard_sidebar.js`,
`dashboard_alerts.js`, `alertss.js`, `app.js` (all under
`src/pages/dashboard/`), `src/lib/lib-members.js`, `src/components/sidebar.js`,
`supabase/functions/process-broadcast/process-broadcast-index.ts`,
`supabase/functions/send-reminders/send-reminders-index.ts`,
`invoice-preview-SAMPLE.html`.

**Not deleted:** `supabase/functions/whatsapp-webhook/whatsapp-webhook-index.ts`.
It looks like the same misnaming, but it is the *only* file in that directory —
it needs renaming to `index.ts`, not removing (`AUDIT.md` D2, handled in Phase 4).

### How to verify

Nothing should look different — that is the whole point. Click through every
page: **Overview, Members, Enquiries, Alerts, Broadcast, Staff, Finance,
Expenses, Plans, Plans Showcase, Gym Settings, Data & Backup, Analytics,
Contact Us**. Open the sidebar, switch theme, open a member, open the notification
bell. If anything 404s or errors, it means I missed an import — tell me and it
is a one-command revert (`git revert`).

---

## PHASE 0b — migration hygiene

**Commit:** `chore(db): rename misnamed 018 migration and document the missing-migration gap`

### Why

`AUDIT.md` finding **D3**. The migration sequence has holes, and one file was
named `supabase--migrations--018_enquiries.sql`, which sorts and applies wrong.

### What changed

- Renamed `supabase--migrations--018_enquiries.sql` → `018_enquiries.sql`.
- Added `supabase/migrations/README.md` documenting: which migrations are
  missing (008, 009, 020, 021, 026, plus the unnumbered
  `flym_rls_multibranch_fix.sql`), which live objects no migration creates
  (`expenses`, `invoices`, `gyms.gst_percentage`, `plans.is_featured`, the
  storage buckets), the apply-order rules, and the value constraints that must
  never change.

### Something only you can do

The audit's Phase 0 called for dumping the live schema to a baseline migration.
**That requires connecting to the live database, which I was asked not to do.**
The exact command is in the new README:

```bash
npx supabase db dump --schema public > supabase/migrations/000_baseline_current.sql
```

Until that exists, **this repository cannot rebuild your database.** That is a
real disaster-recovery gap, not a tidiness issue. Once you've run it and
committed the file, tell me and I'll diff it against what the numbered
migrations produce so we can see exactly what has drifted.

### Also deliberately not done

`.env.local` is still tracked in git. The audit recommended untracking it and
you added it to `.gitignore`, but an ignore rule has no effect on an
already-tracked file, so it is still committed.

I did not untrack it, because I can't verify how your Cloudflare Pages build
gets its environment. **If the build reads the committed `.env.local` rather
than dashboard environment variables, removing it ships an app with no Supabase
URL — a total outage.** The three values in it are public by design
(`VITE_SUPABASE_ANON_KEY` is protected by RLS), so there is no live exposure and
no urgency.

To do it safely: confirm `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
`VITE_VAPID_PUBLIC_KEY` are set in the Cloudflare Pages dashboard, then
`git rm --cached .env.local`.

### How to verify

Nothing user-facing changed. `npm run build` still succeeds. Confirm
`supabase/migrations/` now lists `018_enquiries.sql` in numeric order.

---

## PHASE 1a — indexes that match the queries

**Commit:** `perf(db): add composite indexes matching real query shapes (migration 034)`
**Migration added:** `supabase/migrations/034_scale_indexes.sql` — **not applied, file only**

### Why

`AUDIT.md` finding **A9**. The indexes from migration 001 are almost all
single-column; every query in the app is multi-column with an `ORDER BY`.
Postgres cannot use `members(gym_id)` for
`WHERE gym_id = $1 AND is_active ORDER BY join_date DESC` without reading every
row for that gym and sorting them.

Worse: **the `expenses` table has no indexes at all.** It isn't created by any
migration in this repo, so it was never reviewed. Every expense query is a full
table scan across *all tenants* — one gym opening Finance scans every other
gym's expenses. That's why Finance gets slower as unrelated gyms add data, which
is a baffling failure mode to debug from the outside.

### What changed

**`supabase/migrations/034_scale_indexes.sql` (new, not applied)**

| Index | Serves |
|---|---|
| `members (gym_id, join_date DESC) where is_active` | the members list |
| `members (gym_id, expiry_date) where is_active and not cancelled` | Alerts, notification generation, reminder queue |
| `members (gym_id, payment_status) where is_active and not cancelled` | pending dues |
| `members (gym_id, phone) where is_active and phone not null` | duplicate-phone check (the old index had no `gym_id`, so it scanned matching phones across every tenant) |
| `payment_history (gym_id, paid_at DESC, id DESC)` | the revenue path — the trailing `id` matches the paging tiebreaker from hotfix 1, so the whole `ORDER BY` comes from the index with no sort step |
| `expenses (gym_id, expense_date DESC)` and `(gym_id, expense_month)` | everything expenses, which had nothing |
| `activity_log (gym_id, created_at DESC)` | activity feed |
| `enquiries (gym_id, created_at DESC) where is_active` | enquiries list |

Also in 034:

- `broadcasts.cost_per_msg_paise` default **90 → 150** (`AUDIT.md` B8). The Edge
  Function always writes 150 explicitly so live billing is correct today, but
  the mismatched default is a landmine.
- `get_due_reminders()` now excludes `cancelled_at is not null` (`AUDIT.md` B6).
  Migration 007 predates `cancelled_at`, so members who cancelled were still
  being queued for "please renew" WhatsApps.
- Schedules `cleanup_old_logs()` on pg_cron.

**`src/lib/members.js`** — removed the client-side log prune (`AUDIT.md` A13).
`safeLog()` was firing a `DELETE … WHERE created_at < 90 days` from the browser
on a random ~1% of member writes: an unpredictable full-table delete triggered
by whichever gym owner happened to be using the app. The scheduled job replaces it.

### Two things to know before applying

1. **There is no `begin;`/`commit;` in this file, on purpose.**
   `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. `CONCURRENTLY`
   is used because these tables are live — a plain `CREATE INDEX` takes an
   `ACCESS EXCLUSIVE` lock and would freeze every gym's dashboard while it builds.
   Every statement is idempotent, so if it stops partway, just run it again.

2. **If a concurrent build fails it leaves an invalid index behind**, which is
   never used but still costs write time. Check afterwards:
   ```sql
   select indexrelid::regclass from pg_index where not indisvalid;
   ```
   Expect zero rows. If not, `drop index concurrently <name>;`

### How to verify

1. Apply `034_scale_indexes.sql`, then run the invalid-index check above.
2. **The measurement that matters** — in the SQL editor, before/after:
   ```sql
   explain analyze
   select * from members
    where gym_id = '<gym-id>' and is_active = true
    order by join_date desc limit 50;
   ```
   Expect `Index Scan using idx_members_gym_join_active`, and **no** `Seq Scan`
   and **no** separate `Sort` node. Execution time should drop sharply.
3. Same for revenue:
   ```sql
   explain analyze select * from payment_history
    where gym_id = '<gym-id>' order by paid_at desc, id desc limit 1000;
   ```
   Expect `Index Scan using idx_payment_history_gym_paid_id`.
4. Open **Finance** and **Expenses** in the app — should feel noticeably quicker.
5. `select column_default from information_schema.columns where table_name='broadcasts' and column_name='cost_per_msg_paise';` → **150**.
6. Cancel a member whose expiry is exactly 7 days out, then
   `select * from get_due_reminders();` — they must **not** appear.
7. `select jobname, schedule from cron.job;` — `flym-cleanup-old-logs` present.
8. In the app, add or edit a member and confirm it still saves normally (the
   activity-log prune removal touched that path).

---

## PHASE 1b — admin dashboard stops downloading every member on the platform

**Commit:** `perf(admin): count gyms via gym_summary instead of downloading every member row`

### Why

`AUDIT.md` finding **A7**. `getAllGymsDetail()` selected
`members!members_gym_id_fkey(id)` — **every member row of every gym** — and then
counted the arrays in JavaScript to show one number per table row.

At 50 gyms averaging 5,000 members that is 250,000 rows into the admin's browser
per page load. At the scale Flym is targeting it times out, and you lose the
admin dashboard entirely — which is your ability to support customers.

The daft part: `admin-dashboard.js:87-94` was *already* merging `getGymStats()`
(which reads `gym_summary`, where Postgres computes these counts properly) over
the top. Every one of those downloaded rows was discarded a moment later.

### What changed

`src/lib/admin.js` — `getAllGymsDetail()`

- Dropped the members join. Now two parallel queries, both **one row per gym**:
  the `gyms` columns, and the counts from `gym_summary`.
- Merges them by gym id, and also surfaces `active_members` / `expiring_soon`
  which the view already computed and nobody was using.
- Counts are best-effort — if `gym_summary` is unavailable the gym list still
  renders with zeros instead of failing to an error page.
- Kept the existing `gym_summary`-only fallback for when the `gyms` query fails.

The function's return shape is unchanged, so `loadData()` and the rest of the
admin dashboard needed no edits.

### How to verify

1. Log in as admin. The **Gym Management** list must show the same gyms with the
   same **member counts** and **payment due** counts as before.
2. It should load visibly faster. In DevTools → Network, the `gyms` request
   should now be a few KB rather than megabytes, and there should be no request
   returning thousands of member rows.
3. **Overview** page totals must be unchanged.
4. Open a gym's detail view — phone, address, email and the auto-reminders badge
   must still be populated (these come from the `gyms` query, not the view).

---

## PHASE 1c — WhatsApp Cloud API pinned to v21.0

**Commit:** `fix(wa): pin WhatsApp Cloud API to v21.0 in both senders`

### Why

`AUDIT.md` finding **B9**, and a stated project constraint: WhatsApp Cloud API
stays on **v21.0**. Both senders were calling **v19.0**.

Nothing looks wrong today. But when Meta sunsets v19 the failure is invisible
from the gym's side: automated renewal reminders silently stop, and paid
broadcasts fail *after* the owner has been charged.

### What changed

- `supabase/functions/process-broadcast/index.ts` — v19.0 → **v21.0**
- `supabase/functions/send-reminders/index.ts` — v19.0 → **v21.0**

Both now build the URL from a `WA_API_VERSION` constant at the top of the file
with a comment explaining why it's pinned, so the next bump is one obvious edit
per file rather than a hunt through string literals.

### How to verify

1. `grep -rn 'graph.facebook.com' supabase/functions/` — both hits must show
   `${WA_API_VERSION}` and no `v19.0` anywhere.
2. **These are Edge Functions — I have not deployed them.** They take effect
   only when you run:
   ```
   npx supabase functions deploy process-broadcast
   npx supabase functions deploy send-reminders
   ```
3. After deploying, send a **small** broadcast (1–2 recipients, real phone
   numbers you control) and confirm delivery. This is the only real test — the
   version is a string until Meta receives the call.

---

## PHASE 1d — send-reminders: add authorization, stop chasing cancelled members

**Commit:** `fix(reminders): require CRON_SECRET, exclude cancelled/deleted members, stop false "reminded" stamps`

### Why

Three problems in `supabase/functions/send-reminders/index.ts`.

**1. No authorization at all** (`AUDIT.md` **B7**). The handler ran
`runReminders()` on any request — no secret, no admin check, not even a method
check. Any authenticated Flym user, including a staff member at any gym, could
trigger a **platform-wide WhatsApp send across every gym** and burn your message
quota. If the function was deployed with `--no-verify-jwt`, that was the open
internet.

**2. It messaged cancelled and deleted members** (`AUDIT.md` **B6**). The member
query filtered `expiry_date` and `member_type != 'Trial'` — but not `is_active`
and not `cancelled_at`. Someone who quit the gym and was cancelled still got a
WhatsApp asking them to renew. Cancelled members are excluded from revenue,
dues, broadcasts and notifications everywhere else; reminders were the one place
still chasing them.

**3. It lied about sending.** When no WhatsApp credentials were configured, the
sender returned `true` and the caller stamped `last_reminder_sent = today`. So
the moment you finally configure the API, every member "reminded" during the
unconfigured period is **permanently skipped for that expiry cycle** — they
never get the message.

### What changed

`supabase/functions/send-reminders/index.ts`

- **`x-cron-secret` check**, matching the pattern `generate-notifications`
  already uses correctly. Plus `OPTIONS` preflight handling and a 405 for
  non-POST. Returns 401 on a bad secret, 500 if `CRON_SECRET` isn't set at all.
- Member query now also filters `.eq('is_active', true).is('cancelled_at', null)`.
- The sender returns `'sent' | 'failed' | 'simulated'` instead of a boolean.
  `'simulated'` (no credentials) is counted separately and **does not stamp**
  `last_reminder_sent`. The response body now includes a `simulated` count.
- Updated the stale file header, which claimed it used wa.me deep links.

### ⚠️ Applying this needs a secret set, or reminders stop

`CRON_SECRET` is already required by `generate-notifications`, so it is probably
already set — but **confirm before deploying**, because if it isn't, this
function will start returning 500 and no reminders will go out:

```
npx supabase secrets list          # look for CRON_SECRET
npx supabase secrets set CRON_SECRET=<your-existing-value>
```

Whatever calls this function on a schedule must now send the
`x-cron-secret` header. Migration 032 shows the pattern for
`generate-notifications`; the same is needed here.

### How to verify

1. **Not deployed by me.** Deploy with `npx supabase functions deploy send-reminders`.
2. **Auth works:** `curl -X POST <function-url>` with no header → **401
   Unauthorized**. With the correct `x-cron-secret` header → 200 and a JSON
   summary.
3. **Cancelled members excluded:** cancel a member whose expiry is exactly
   `reminder_days` away, run the function, and confirm they are **not** in the
   returned `log` array.
4. **Deleted members excluded:** same test with a removed (`is_active=false`)
   member.
5. **No false stamps:** if WhatsApp credentials are not configured, run it and
   check the response — members should appear under `simulated`, and their
   `last_reminder_sent` in the database must be **unchanged**.
6. Confirm your scheduled caller sends the new header, or reminders will
   silently stop the next morning.

---

## PHASE 2a — broadcast recipients resolved server-side

**Commit:** `fix(broadcast): resolve recipients from the database instead of trusting the browser`

### Why

`AUDIT.md` finding **B2**, the most serious security issue in the audit.

`create-broadcast-order` accepted a `recipients` array of
`{member_id, member_name, phone}` **from the browser** and inserted it verbatim
as the send list. It verified the caller owned the gym — but never that those
member IDs belonged to that gym, that they were active, or that they weren't
cancelled.

Anyone who can open dev tools on their own gym dashboard could therefore make
**Flym's WhatsApp Business number send arbitrary text to arbitrary phone
numbers**. They pay ₹1.50 each, so it isn't theft — but it is your sender
reputation and your Meta account. One spam run gets the number rate-limited or
banned, and broadcasts go down **for every paying gym on the platform**.

It also meant "cancelled members are never in a broadcast" was enforced only in
the UI (`broadcast.js:225`) and could simply be bypassed.

### What changed

**`supabase/functions/create-broadcast-order/index.ts`**

- Takes `member_ids: string[]`. Names and phone numbers are now looked up from
  the `members` table, filtered by `gym_id`, `is_active = true` and
  `cancelled_at is null`. Anything the client sends about a recipient beyond
  their ID is ignored.
- Members whose phone has fewer than 10 digits are dropped — unreachable, so
  the owner isn't charged for them.
- Lookups are chunked at 200 IDs, because a 5,000-UUID `in.()` filter would
  exceed the URL length limit.
- **The cost is computed from the server-resolved count**, so the owner is
  charged for exactly the messages that will be attempted.
- The gym-ownership check now includes `role = 'owner'`. It previously matched
  on `user_id` + `gym_id` only, which a staff member of that gym would pass.
- Still accepts the legacy `recipients` array, but **only to read IDs out of
  it** — so an old cached browser tab keeps working during rollout without
  reopening the hole.

**`src/lib/broadcast.js`** — `createBroadcastOrder(gymId, message, memberIds)`
now sends `member_ids`.

**`src/pages/dashboard/broadcast.js`** — sends IDs, and if the server resolves
**fewer** recipients than were selected (someone was cancelled on another device
since the list loaded), shows an amber toast naming the difference **before**
the Razorpay sheet opens. The count should never silently change between the
review screen and the bill.

### How to verify

1. **Not deployed by me.** Deploy with
   `npx supabase functions deploy create-broadcast-order`.
2. **Normal path:** select 2 members with real phone numbers you control, review
   → pay → confirm both receive the message and the charge is 2 × ₹1.50.
3. **The security test.** In dev tools, intercept the call (or use `curl` with
   your session token) and post a `member_ids` array containing a **member ID
   from a different gym**. The order must come back with that member **excluded**
   — or fail with "No valid recipients" if it was the only one. Before this
   change, sending a raw phone number in `recipients` would have messaged it.
4. **Cancelled exclusion:** select a member, then cancel their membership in
   another tab, then complete the broadcast. They must be excluded, you must see
   the amber "can no longer be messaged" toast, and the bill must be lower.
5. Check the `broadcast_recipients` rows — `phone` must be digits-only and match
   what's in the `members` table.

---

## PHASE 2b — exports read the complete data set, not the capped dashboard state

**Commit:** `fix(backup): export the full member and expense sets instead of the capped in-memory state`

### Why

`AUDIT.md` finding **A2**. Every export in **Data & Backup** was built from
`S.members`, which `getMembers()` caps at 5,000 because that array drives the
dashboard UI. So the "Full Backup" for a gym over 5,000 members was silently
missing everyone after the 5,000th.

An owner clicks **JSON Backup**, gets a file, and believes their business is
safe. They find out otherwise on the worst day of their year.

Hotfix 1 already fixed the payment-history half of this. This is the member and
expense half.

Expenses had a related problem: `getAllExpenses()` and `getExpensesByRange()`
had no paging, and PostgREST applies a server-side row cap of its own — so the
P&L, year-end and GST reports could be summing a *prefix* of the expense ledger.
For money, a silently-truncated total is worse than an error.

### What changed

**`src/lib/members.js`** — new `getAllMembers(gymId)`: pages the full member set
with no cap. `getMembers()` is untouched and still caps at 5,000 for the UI;
the rule is now simply *anything that writes a file uses `getAllMembers`*.

**`src/lib/expenses.js`** — `getAllExpenses()` and `getExpensesByRange()` now
page through their full result sets.

Both use a `(date DESC, id DESC)` sort. The date columns are `DATE`, not
timestamps, so same-day rows tie *exactly*; without the `id` tiebreaker rows
shuffle between pages and an export gets duplicates and omissions — the same
trap as hotfix 1.

**`src/pages/dashboard/backup.js`** — added `exportMembers()`, fetched once per
visit to the page and reused, and switched all nine export paths to it: members
CSV, members PDF, payments report (both the payment-history branch and the
member fallback branch), year-end summary, outstanding payments, JSON backup and
the full PDF backup. Four click handlers became `async` as a result.

`filterMembersForExport()` now takes the member list as its first argument
rather than reaching for `S.members`, so it can't silently regress to the capped
list later.

### Note on cost

For a gym with 50,000 members the JSON backup now downloads 50,000 rows. That is
slower than before, and correct rather than wrong. Streaming exports would be
the next step if it becomes a problem in practice.

### How to verify

1. **Data & Backup → JSON Backup.** Open the file and count the `members` array.
   It must equal the true total:
   ```sql
   select count(*) from members where gym_id = '<gym-id>' and is_active = true;
   ```
   For a gym over 5,000 members it used to stop at exactly 5,000.
2. **Members CSV** — row count must match the same total (minus any filters).
3. **Outstanding Payments report** — the member count and total must match
   Finance → Pending Dues.
4. Run every other export and confirm none of them error, since four handlers
   changed to `async`: Members PDF, Payments report, Year-End Summary, P&L, GST
   Summary, Full PDF Backup, Expenses CSV.
5. Open the console during a large export — no `hit the ... ceiling` warning.

---

## PHASE 2c — remaining UTC date bugs in staff salary handling

**Commit:** `fix(staff): use local dates, not UTC, for join date, salary date and month-end`

### Why

`AUDIT.md` finding **B17**, the rest of it. Hotfix 1 fixed the
`getPaymentsByMonth` case; three more sites remained in `src/lib/staff.js`.

`new Date().toISOString().split('T')[0]` reads **UTC**. For IST (UTC+5:30) that
is the *previous day* for the first five and a half hours of every day. The
codebase already knows this — `helpers.js` has `todayLocalISO()` written
specifically to avoid it, with a comment explaining why — but `lib/staff.js`
never got the fix.

**What that looks like in the gym:** a trainer's salary recorded at 1am on the
1st of the month gets dated the 30th of the previous month. It lands in the
wrong month's expenses, the wrong P&L row, and the wrong monthly salary total.

### What changed

`src/lib/staff.js`

- Added local `localISODate()` / `todayLocalISO()` helpers, matching the pattern
  already used in `lib/expenses.js`.
- `addStaff()` — default `join_date` is now local today.
- `addSalaryPayment()` — default `payment_date` is now local today. This one
  also feeds `expense_month`, so it was mis-filing the linked expense too.
- `getStaffMonthlyPaid()` — month-end date computed locally, so the **last day
  of the month** is no longer excluded from a staff member's monthly total.

### How to verify

Best tested near midnight IST, but you can force it:

1. Add a salary payment **without** picking a date, between 00:00 and 05:30 IST.
   `payment_date` must be **today**, not yesterday. Before this it was yesterday.
2. Check the auto-created expense in **Expenses** — it must appear in the
   current month.
3. Add a salary payment dated the **last day** of a month, then open that staff
   member's monthly total for that month. It must include that payment.
4. Add a staff member with no join date — it must show today's date.

---

## PHASE 2d — revenue is summed by Postgres, not by the phone

**Commit:** `perf(finance): sum revenue in Postgres via migration 035 instead of downloading every payment`
**Migration added:** `supabase/migrations/035_revenue_aggregation.sql` — **not applied, file only**

### Why

The performance half of `AUDIT.md` **A1**. Hotfix 1 made revenue *correct* by
paging through every payment instead of capping at 1,000 — which fixed the wrong
numbers and made a new problem obvious: a gym with 50,000 payments now downloads
50,000 rows to a phone in order to add them up. Postgres does that in
single-digit milliseconds and returns one row.

### The design decision that matters here

**The client computes the period boundaries; the server never decides what
"this month" means.**

Finance already builds its period bounds from the browser's local calendar
(`getPeriodBounds`), correctly for IST. If the server independently worked out
"this month", the two definitions would disagree — around midnight, on the 1st —
and the revenue figure would depend on *which code path produced it*. That is a
nasty class of bug and an expensive one to be wrong about.

So the RPCs take `start` and `end` timestamps as arguments and just sum between
them. Drift is structurally impossible, and the fallback path is guaranteed to
agree with the server path.

### What changed

**`supabase/migrations/035_revenue_aggregation.sql` (new, not applied)**

- `flym_revenue_summary(gym, start, end)` — total, count, and the Cash/Card/Online
  split in one row. Replaces four full-array reduces per render, run twice (this
  period and the previous one).
- `flym_revenue_monthly(gym, starts[], ends[])` — the 6-month chart in one round
  trip. `LEFT JOIN` so a month with no revenue returns 0 rather than being
  missing, which would silently mislabel the chart.
- `flym_revenue_rows(gym, start, end, limit, offset)` — one page of the
  drill-down table. It was slicing 200 rows out of an array of every payment the
  gym had ever taken.

Filter parity with the old JS is exact: same gym scope, same
`members.is_active` inner-join semantics (soft-deleted members' payments stay
out of revenue), same inclusive-both-ends range. Not `SECURITY DEFINER`, so RLS
applies — same reasoning as migration 033.

**`src/lib/members.js`** — `getRevenueSummary` / `getRevenueMonthly` /
`getRevenueRows`. Each returns **`null`** when 035 isn't applied, which means
"ask the old way". An empty result means "genuinely no revenue". Conflating
those two would show a gym **₹0** instead of falling back — precisely the kind
of silent wrong number this whole exercise is about.

**`src/pages/dashboard/finance.js`** — tries the server path first and falls back
to the existing download-and-sum. Detail rows are normalised to one shape so the
markup doesn't care which path produced them. Also escaped the payment-mode
label on the way past (`AUDIT.md` B12).

### Behaviour change to be aware of

When 035 is applied, Finance no longer refreshes `S.payHistory`. Overview and
Analytics still read the copy loaded at dashboard boot, so their revenue figures
are now as fresh as your last page load rather than as fresh as your last visit
to Finance. Those two pages get the same treatment in Phase 3.

### How to verify — do this one carefully, it is money

1. **Before applying 035**, note down Finance → **All Time**, **This Year** and
   **This Month** revenue, the payment count, and the Cash/Card/Online split.
2. Apply `035_revenue_aggregation.sql`. Reload Finance.
3. **Every one of those numbers must be identical.** If any moved, stop and tell
   me — that means the two paths disagree and I need to fix the parity.
4. Cross-check the total against the database directly:
   ```sql
   select coalesce(sum(ph.amount),0), count(*)
     from payment_history ph
     join members m on m.id = ph.member_id and m.is_active
    where ph.gym_id = '<gym-id>';
   ```
5. Click each period button (Today / Week / Month / Last Month / Year / All) and
   a **custom range**. Check the ↑/↓ growth percentages still render.
6. Expand the **Revenue breakdown** panel — 200 rows max, names and dates
   correct, "Showing 200 of N" accurate.
7. The **Revenue vs Expenses** 6-month chart must have the same bars as before,
   including any empty months.
8. Watch the Network tab: on a gym with lots of payments, Finance should no
   longer download thousands of `payment_history` rows.
