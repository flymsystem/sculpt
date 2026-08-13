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
