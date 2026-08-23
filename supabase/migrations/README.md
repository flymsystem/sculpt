# Flym migrations — read this first

## Baseline: `000_baseline_current.sql`

`000_baseline_current.sql` is a `pg_dump --schema-only` of the live `public`
schema, taken 2026-08-23 straight after the Supabase account transfer. It is
**the truth**. Everything numbered `001`–`117` is historical record.

It covers 18 tables, 33 functions and 64 RLS policies. Six migrations
(`008`, `009`, `020`, `021`, `026`, and the unnumbered
`flym_rls_multibranch_fix.sql`) are still missing from version control, and
several live objects were never created by any file here — `expenses`,
`gyms.gst_percentage`, `plans.is_featured`, and the `member-photos` /
`aadhar-photos` / `invoices` storage buckets. The baseline dump contains all
of them, so the schema can now be rebuilt from this directory. That was not
true before.

> **Correction to an earlier note in this file:** there is no `invoices`
> table and there never was. Invoice PDFs are generated on demand from
> `payment_history` (see `genInvoiceNo()` in `helpers.js`) and stored in the
> `invoices` bucket. `sculpt_my_receipts()` returns payment rows, not
> invoice rows.

**Two things the baseline does NOT contain**, because a `public`-schema dump
skips them — worth knowing before anyone tries a from-scratch rebuild:

- the `auth` and `storage` schemas (users, bucket rows, storage policies)
- `pg_cron` job definitions, which live in the `cron` schema
  (migration 032's notification job is the one that matters)

To refresh the baseline later, from the repo root:

```powershell
$env:PGPASSWORD = '<database password>'
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -h aws-0-ap-northeast-2.pooler.supabase.com -p 5432 -U postgres.acigxzbbchhisaymklld -d postgres --schema public --schema-only --no-owner --no-privileges -f supabase/migrations/000_baseline_current.sql
Remove-Item Env:\PGPASSWORD
```

`npx supabase db dump` does the same job but needs Docker Desktop installed;
`pg_dump` directly does not.

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
- `104_member_accounts.sql` — member auth link, auto-generated application
  numbers, added-by attribution, member RLS on `members`/`payment_history`
- `107_member_checkins.sql` — `member_checkins` table, `sculpt_member_checkin()`,
  `sculpt_manual_checkin()` (offline-tablet fallback)
- `108_member_portal_readers.sql` — `sculpt_my_membership()`, `sculpt_my_visits()`,
  `sculpt_my_receipts()`
- `109_checkin_followup.sql` — `gyms.checkin_followup_days`, `sculpt_checkin_followup()`,
  adds `member_checkins` to the realtime publication
- `110_invoices_private.sql` — flips the `invoices` storage bucket private,
  adds the member-scoped read policy
- `111_fix_returns_table_column_shadowing.sql` — fixes the `RETURNS TABLE`
  column-shadowing bug in `sculpt_issue_checkin_token` / `sculpt_member_checkin` /
  `sculpt_manual_checkin`. Applied; partially confirmed (2 of 4 `checkin.spec.js`
  failures cleared) — see HANDOVER.md's "In-progress debugging" note before
  assuming this is fully resolved.

**Not yet applied:**

- `112_backfill_application_numbers.sql` — backfills `application_number` on
  active members added before this feature existed. Safe to run whenever;
  does NOT touch the generation path itself (see HANDOVER.md note).
- `113_widen_gym_users_role_check.sql` — widens `gym_users_role_check` to
  allow `role = 'staff'`. Applied by hand in the SQL editor on 2026-08-22,
  before this file existed; recorded here idempotently. Without it,
  `gym_users_role_check` (still `('owner', 'admin')` from
  `001_initial_schema.sql`) rejects every attempt to create a staff login —
  `030_staff_login_tiers.sql` built the whole staff-login feature around
  `role = 'staff'` but never widened the constraint it depends on.
- `114_fix_add_member_stale_helper_call.sql` — `sculpt_add_member`
  (`104_member_accounts.sql`) called `flym_assert_payment_mode`, a name
  `100_sculpt_rename_identifiers.sql` had already renamed to
  `sculpt_assert_payment_mode` by the time 104 runs. Every Add Member
  submission failed with a 42883 that PostgREST/the client blamed on
  `sculpt_add_member` itself. See the file header for the full trace and
  CLAUDE.md for the sweep of every other function checked for the same bug
  (this was the only one found).
- `115_staff_login_revocation.sql` — **security fix.**
  `get_my_gym_id_as_staff()` only checked for a `gym_users` row with
  `role = 'staff'`; it never checked `staff.is_active` or
  `staff.login_enabled`. A removed or disabled staff member could still
  read every member's name, phone, Aadhaar photo and payment history.
  Every staff RLS policy and staff RPC goes through this one function, so
  fixing it here revokes access everywhere at once — no separate "also
  revoke the login" step for the app to remember.
- `116_staff_login_metadata.sql` — adds `staff.login_email` /
  `staff.login_created_at`, written by `create-staff-user` /
  `manage-staff-login` (service role), read by the Staff page so the owner
  can see login status without an extra round trip per row.

**Edge Functions to (re)deploy alongside 114–116:**

- `supabase functions deploy create-staff-user` — now also writes
  `login_email` / `login_created_at`.
- `supabase functions deploy manage-staff-login` — new. Owner-only:
  reset password, disable/enable, remove login, change login email.

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
| `gym_users.role` | `owner` \| `admin` \| `staff` (as of migration 113 — see below) |
| `staff.login_enabled` | Checked by `get_my_gym_id_as_staff()` as of migration 115 — flipping it to `false` revokes dashboard/RPC access immediately, not just hides UI. |

Soft delete is `is_active = false` everywhere **except `expenses`**, which hard
deletes. `cancelled_at` is a separate concept from `is_active` — a cancelled
member is still active and still visible.
