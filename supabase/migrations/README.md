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

- `118_member_phone_unique.sql` — normalises `members.phone` to the
  canonical `+91XXXXXXXXXX` form and adds a partial UNIQUE index
  (`gym_id, phone` where `is_active = true`) so a duplicate active phone
  number is rejected at the DB layer, not just by the client-side
  pre-check. Skips creating the index (with a NOTICE naming how many
  groups) if real duplicates already exist — resolve those by hand, then
  re-run. Also gives `sculpt_add_member` a friendly error message on that
  constraint instead of a raw Postgres error.
- `119_fix_renew_clear_balance_stale_calls.sql` — **`sculpt_renew_member`
  and `sculpt_clear_balance` have been failing on every call in
  production**, same bug class as 114: both still call the pre-rename
  `flym_assert_payment_mode` / `flym_addons_to_jsonb` (100 renamed those
  to `sculpt_*` but never touched these two call sites). The client's
  `isMissingFunction()` treats the resulting 42883 as "not migrated yet"
  and silently falls back to the non-atomic legacy JS path, so renewals
  and balance-clears still basically work today but without the
  transaction/row-lock guarantee HANDOVER.md §6 calls load-bearing.
  Also adds a 5-second duplicate-renewal guard (FIX-PROMPT item 18).
- `120_storage_staff_access.sql` — the storage.objects policies from 101
  keyed only on `get_my_gym_id()`, which returns NULL for a staff
  session (it only matches `role = 'owner'`). Every staff photo/Aadhaar
  upload, view and delete has been silently denied. Widens the four
  policies to accept `get_my_gym_id_as_staff()` too.
- `121_revenue_includes_deleted_members.sql` — `sculpt_revenue_summary` /
  `_monthly` / `_rows` filtered to `members.is_active = true`, so
  soft-deleting a member with payment history silently dropped their
  entire history from every revenue total. Removes that filter — a
  gym's lifetime revenue must not change just because someone was
  deleted afterward.
- `122_member_expiry_manual_override.sql` — `set_member_expiry()`
  (the trigger behind `trg_member_expiry`) unconditionally recomputed
  `expiry_date` on every UPDATE to a non-Trial member, silently
  overwriting any manually-set value in the same statement — there was
  no working way to hand-edit a member's expiry date. Now only
  recomputes on INSERT, or when `join_date`/`plan_duration_months`
  actually change.
- `123_staff_rls_hardening.sql` — `staff_update_members` had no
  `WITH CHECK`, so a direct API call could flip `is_active = false`
  (soft-delete) even though the UI hides that button for staff. Adds a
  `WITH CHECK (... AND is_active = true)`. `staff_read_payments` had no
  scoping beyond `gym_id` — full gym-wide revenue history one API call
  away regardless of the Finance route guard. Scopes it to payments made
  today (gym-local timezone), enough for staff to see what they just
  collected without exposing history.

- `124_fix_renew_expiry_no_op_join_date.sql` — found verifying 122 end to
  end against the live DB: renewing an expired member whose stored
  `join_date` already equalled the computed renewal date (e.g. same-day
  trial-to-paid, or a second same-day renewal) silently left
  `expiry_date` unchanged — 122's "only recompute when join_date/duration
  change" trigger guard saw no change and did nothing, and
  `sculpt_renew_member` never set `expiry_date` itself. Now computes and
  sets it explicitly in the same UPDATE, so it's correct regardless of
  whether the trigger's guard fires.
- `125_fix_gym_display_name.sql` — the live `gyms.name` was `"D fitness"`;
  fixed to `"D Sculpt Fitness"` everywhere it's surfaced (member portal
  header, member login, `auth-flow.spec.js`'s expectation). Applied and
  live-verified (2026-08-26).
- `126_member_photo_url_column.sql` — `members.photo_url` never existed
  as a live column, so a member photo upload's storage write succeeded
  but the follow-up `members` row update silently failed; `photo_url`
  also had to be added to `members_with_status`'s explicit SELECT list
  (appended at the end — `CREATE OR REPLACE VIEW` can't insert a column
  mid-list, error `42P16`). Applied and live-verified.
- `127_gym_audit_identity_fields.sql` — adds `gyms.pan`, `legal_name`,
  `registered_address` for the "Financial & GST Audit Support Report"
  (see `HANDOVER.md`'s 2026-08-26 entry). `gyms.gstin`/`address`/`city`
  already existed and were left untouched. Applied via
  `npx supabase db push` failing (`LegacyDbPushMissingRemoteError` — see
  the "process note" below) and `npx supabase db query --linked`
  succeeding instead; live-verified via `information_schema.columns`.
- `128_fix_renew_duplicate_guard_future_paid_at.sql` — `sculpt_renew_member`'s
  "reject an exact-repeat renewal within 5 seconds" guard compared
  wall-clock `now()` against `payment_history.paid_at` — but `paid_at` for a
  renewal is deliberately set to the renewal's *effective join date*
  (`toPaidAtTimestamp(r.joinDate)` in `src/lib/members.js`), not the actual
  submission time. Renewing a still-active membership (the normal case —
  renewing before expiry) always computes a join_date in the future, so
  `paid_at >= now() - interval '5 seconds'` was true forever, not just for
  5 real seconds — permanently blocking every later renewal of the same
  member at the same plan+price with "This renewal was already recorded a
  moment ago". Found by actually driving a renew-while-active → renew-again
  sequence live, not by reading the SQL. Fixed by adding
  `payment_history.created_at` (defaults to `now()`, doesn't touch any
  existing row's behaviour) and checking that instead. Applied via
  `npx supabase db query --linked --file` and live-verified (2026-08-26/27).
- `129_sculpt_delete_member_permanently.sql` — adds an owner-only hard
  delete (`sculpt_delete_member_permanently`) alongside the existing
  soft delete. Migration 121 made Remove (is_active=false) correctly
  keep a departed member's historical revenue forever — but that left
  no way to undo a genuine mistake or test entry, which is what staff
  hit during the 2026-08-27 client demo (three test members, ₹2,500
  each, stuck in Finance after being Removed). This function hard-DELETEs
  the `members` row; every FK from `payment_history`/`reminder_logs`/
  `member_checkins` to `members.id` is already `ON DELETE CASCADE`
  (migration 001/033), so no separate cleanup step is needed. Applied
  via `npx supabase db query --linked -f`; live-verified by inserting a
  test member+payment, confirming the RPC's owner check rejects an
  unauthenticated caller (`NOT_AUTHORIZED`), then deleting directly and
  confirming `sculpt_revenue_summary`'s total dropped by exactly that
  payment's amount. The three real demo test members (`SC-0002`,
  `SC-0003`, `SC-0004`) were purged from production the same way on
  2026-08-27 — `sculpt_revenue_summary` now correctly reads ₹0 (the gym
  currently has zero real members).
  **Same day, later revision:** the "alongside the existing soft delete"
  framing above didn't survive first contact with the client — after
  seeing this in the app, they were explicit that they didn't want a
  separate "delete permanently" escalation with a typed confirmation at
  all: Remove should just erase the member's money everywhere, full
  stop. `deleteMember()` (soft-delete) was removed from every UI call
  site — `member-modals.js`'s Remove-member modal and `members.js`'s
  batch delete both now call `deleteMemberPermanently()` directly, no
  extra step. `sculpt_delete_member_permanently` itself (this migration)
  is unchanged; only which action the client-facing "Remove" button
  performs changed. `deleteMember()` still exists in `src/lib/members.js`
  purely as a test-cleanup convenience — see the comment above it.
- `130_member_login_attempts_reject_reason.sql` — the client-visible
  member login error is deliberately identical across five different
  rejection paths (enumeration guard, see member-signin/index.ts), which
  made the 2026-08-27 login outage slow to diagnose from the outside —
  the actual cause (`src/lib/member-auth.js`'s `GYM_CODE` hardcoded to
  `'SCULPT01'` while production's `gyms.gym_code` is `'DSCULPT'`, so
  every login failed at the gym-lookup step) was only found by cross-
  referencing `member_login_attempts.gym_id = null` across every attempt
  by hand. Adds a server-only `reject_reason` column
  (`NO_GYM`/`NO_MEMBER`/`PHONE_MISMATCH`/`MISSING_FIELDS`/`RATE_LIMITED`,
  null on success), written by the redeployed `member-signin` function.
  `member_login_attempts` has no client SELECT policy, so this doesn't
  touch the enumeration boundary — the HTTP response is unchanged; only
  console logs and this column carry the reason now. Applied via
  `npx supabase db query --linked -f`; function redeployed via
  `npx supabase functions deploy member-signin` same day. Live-verified:
  a real member add→login round trip (`SC-TEST-LOGIN`) succeeded end to
  end against the deployed function, and deliberately-wrong phone vs.
  deliberately-wrong application number produced the identical client
  error but distinct `PHONE_MISMATCH`/`NO_MEMBER` rows.
- **Same day, follow-up hardening (no new migration file — a
  `member-signin` code change):** the `GYM_CODE` fix above corrected the
  *value*; this removes the whole bug *class*. `member-signin` no longer
  reads or trusts a client-supplied `gymCode` at all — CLAUDE.md is
  explicit that there is exactly one gym, so the function now resolves
  the sole `is_active = true` gym itself. `NO_GYM` can now only fire if
  the database genuinely has no active gym row; it can no longer be
  triggered by any client-side drift. `src/lib/member-auth.js` no longer
  exports or sends `GYM_CODE` for login. Redeployed and live-verified:
  a fresh member (`SC-TEST-DIAG`) signed in successfully with no
  `gymCode` field in the request body at all; a wrong application number
  and a wrong phone number against that same member each produced the
  identical client error with distinct `NO_MEMBER`/`PHONE_MISMATCH`
  `reject_reason` rows. `checkin-display.js`'s QR payload and
  `landing.js`'s public-plans lookup are unrelated call sites that still
  read `gym_code` for their own reasons and still rely on
  `scripts/verify-schema.mjs`'s drift check.

**`npx supabase db push` is currently broken for this project** — a
process note, not specific to any one migration. `npx supabase migration
list` shows the remote's tracked migration history has diverged from
local files starting at `102`: every migration `102`–`127` shows
`remote: ""` even though their schema changes are demonstrably live
(confirmed via `information_schema.columns`/`pg_proc` directly). This
predates migrations 126/127 and wasn't introduced by them. Repairing
`supabase_migrations.schema_migrations` is a separate, riskier job;
until then, apply new migrations' SQL directly with
`npx supabase db query --linked` and independently verify against live
`information_schema.columns`/`pg_get_functiondef`/`pg_get_viewdef` rather
than trusting `db push` to report success or failure correctly.

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
