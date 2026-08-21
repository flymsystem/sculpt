# Flym migrations — read this first

## ⚠️ This directory cannot currently rebuild the database

Six migrations are **missing from version control**: `008`, `009`, `020`, `021`,
`026`, and the `flym_rls_multibranch_fix.sql` at the end has no number so its
position in the sequence is guesswork.

Things the live database has that **no migration here creates**:

| Missing object | Referenced by |
|---|---|
| `expenses` table | `src/lib/expenses.js`, Finance, Expenses page |
| `invoices` table + storage bucket | `src/lib/invoices.js`, `029_invoice_pdf_storage.sql` assumes it |
| `gyms.gst_percentage` | `src/pages/dashboard/backup.js` (GST summary) |
| `plans.is_featured` | `src/pages/dashboard/backup.js`, plans showcase |
| `member-photos` / `aadhar-photos` buckets | photo upload |

**What this means in practice:** if the Supabase project were lost, the schema
could not be reconstructed from this repository. It is also why nobody noticed
that the `expenses` table has **no indexes at all** — the table isn't in version
control, so it was never reviewed.

### Fixing it — one command, and it needs you

I could not do this myself: it requires connecting to the live database, and I
was asked not to run anything against it. Please run, from the repo root:

```bash
npx supabase db dump --schema public > supabase/migrations/000_baseline_current.sql
```

Then commit that file. From that point on, `000_baseline_current.sql` is the
truth and `001`–`032` are historical record only. Tell me once it exists and I
will diff it against what the numbered migrations produce, so we know exactly
what drifted.

---

## Applying order

Migrations are applied in filename order. `001`–`032` plus
`flym_rls_multibranch_fix.sql` are **already applied to production** (that is
the assumption this repo works from — the baseline dump above is what would
confirm it).

Anything numbered **033 and above is new and has not been applied.** See
`HANDOVER.md` in the repo root for the exact list and the order to run them in.

**QR check-in feature.**

Applied to production (run by hand in the SQL editor, verified):

- `103_gym_timezone.sql` — adds `gyms.timezone` (default `Asia/Kolkata`)
- `105_checkin_tokens.sql` — rotating token table + `sculpt_issue_checkin_token()`
- `106_staff_checkin.sql` — `sculpt_staff_checkin()`, upserts `staff_attendance`

**Not yet applied — run in this order:**

- `104_member_accounts.sql` — member auth link, auto-generated application
  numbers, added-by attribution, member RLS on `members`/`payment_history`
- `107_member_checkins.sql` — `member_checkins` table, `sculpt_member_checkin()`,
  `sculpt_manual_checkin()` (offline-tablet fallback)
- `108_member_portal_readers.sql` — `sculpt_my_membership()`, `sculpt_my_visits()`,
  `sculpt_my_receipts()`
- `109_checkin_followup.sql` — `gyms.checkin_followup_days`, `sculpt_checkin_followup()`,
  adds `member_checkins` to the realtime publication
- `110_invoices_private.sql` — flips the `invoices` storage bucket private,
  adds the member-scoped read policy (run this one last — `src/lib/invoices.js`
  already assumes it's landed and uses signed URLs)

## Rules

- **Never edit an applied migration.** Write a new one.
- Numbers are sequential and never reused.
- Every migration must be **idempotent** where practical (`if not exists`,
  `create or replace`, `drop policy if exists` before `create policy`) — the
  existing files follow this and it makes a partial failure recoverable.
- Long-running index builds on live tables should use
  `CREATE INDEX CONCURRENTLY`, which **cannot run inside a transaction block** —
  so those migrations must not be wrapped in `begin; … commit;`.

## Value constraints that must not change

These are relied on by the frontend, the Edge Functions and existing rows:

| Column | Allowed values |
|---|---|
| `members.payment_mode`, `payment_history.payment_mode` | `Cash` \| `Online` \| `Card` |
| `members.payment_status` | `Paid` \| `Due` \| `Partial` |
| `members.member_type` | `Paid` \| `Unpaid` \| `Trial` |
| `gyms.subscription_tier` | `core` \| `pro` |

Soft delete is `is_active = false` everywhere **except `expenses`**, which hard
deletes. `cancelled_at` is a separate concept from `is_active` — a cancelled
member is still active and still visible.
