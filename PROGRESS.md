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
