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
