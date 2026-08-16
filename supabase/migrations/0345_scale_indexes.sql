-- ═══════════════════════════════════════════════════════════════════
-- Migration 034 — Indexes that match the queries, plus small fixes
-- (034b — non-concurrent variant for the Supabase SQL editor)
-- ═══════════════════════════════════════════════════════════════════
-- Fixes AUDIT.md A9 (missing composite indexes), A13 (log pruning),
-- Index coverage for the hot query paths.
--
-- ── WHY THIS VERSION EXISTS ────────────────────────────────────────
-- The original 034 used CREATE INDEX CONCURRENTLY. The Supabase SQL
-- editor always wraps submitted SQL in a transaction and gives you no
-- way to turn that off, and CONCURRENTLY cannot run inside one — it
-- fails with "ERROR: 25001". So that file could never be applied from
-- the dashboard.
--
-- This variant drops CONCURRENTLY. The tradeoff is that each
-- CREATE INDEX takes an ACCESS EXCLUSIVE lock on its table while the
-- index builds — reads and writes to that one table wait. On tables of
-- a few tens of thousands of rows that is well under a second each.
-- CHECK YOUR ROW COUNTS FIRST if you have not already:
--
--   select 'members' t, count(*) from members
--   union all select 'payment_history', count(*) from payment_history
--   union all select 'expenses', count(*) from expenses
--   union all select 'activity_log', count(*) from activity_log
--   union all select 'enquiries', count(*) from enquiries;
--
-- Under ~100,000 rows per table: run this file, it is a blip.
-- In the millions: do NOT run this. Use psql with the original 034
-- so the builds stay concurrent.
--
-- Because there is no CONCURRENTLY here, this file IS safe inside a
-- transaction, so it is wrapped in one deliberately: it either fully
-- applies or fully rolls back. Every statement is also idempotent
-- (`if not exists` / `or replace`), so re-running it is harmless.
--
-- ── WHY THESE INDEXES AND NOT THE EXISTING ONES ────────────────────
-- The indexes from migration 001 are almost all single-column, but
-- every query in the app is multi-column with an ORDER BY. Postgres
-- cannot use `members(gym_id)` to satisfy
--   WHERE gym_id = $1 AND is_active ORDER BY join_date DESC
-- without reading every row for that gym and sorting them. A composite
-- index whose columns match the filter *and* the sort turns that into a
-- straight range scan.
--
-- Partial indexes (`where is_active`) are used where the app never
-- queries the excluded rows. They are smaller, so more of the index
-- stays in cache — but they are only usable when the query's own
-- WHERE clause implies the index predicate, which is why the predicates
-- below mirror the real queries exactly.
-- ═══════════════════════════════════════════════════════════════════

begin;


-- ═══════════════════════════════════════════════════════════════════
-- 1. members
-- ═══════════════════════════════════════════════════════════════════

-- getMembers() / members_with_status:
--   WHERE gym_id = $1 AND is_active ORDER BY join_date DESC
create index if not exists idx_members_gym_join_active
  on public.members (gym_id, join_date desc)
  where is_active = true;

-- Alerts, notification generation, and the reminder queue all ask
-- "who in this gym expires around now", always excluding cancelled.
--   generate-notifications: gym_id + is_active + cancelled_at is null
--   send-reminders:         gym_id + expiry_date + is_active + cancelled
create index if not exists idx_members_gym_expiry_live
  on public.members (gym_id, expiry_date)
  where is_active = true and cancelled_at is null;

-- Pending-dues queries (Finance, Alerts, Overview).
create index if not exists idx_members_gym_paystatus_live
  on public.members (gym_id, payment_status)
  where is_active = true and cancelled_at is null;

-- checkDuplicatePhone(): gym_id + is_active + phone in (...).
-- Supersedes idx_members_phone from 023, which had no gym_id and so
-- had to scan matching phones across every tenant.
create index if not exists idx_members_gym_phone_active
  on public.members (gym_id, phone)
  where is_active = true and phone is not null;


-- ═══════════════════════════════════════════════════════════════════
-- 2. payment_history — the revenue path
-- ═══════════════════════════════════════════════════════════════════
-- getPaymentHistory() pages with
--   WHERE gym_id = $1 ORDER BY paid_at DESC, id DESC
-- The trailing id matches the tiebreaker the client added so paging is
-- stable, which lets the whole ORDER BY be served from the index with
-- no sort step at all.
create index if not exists idx_payment_history_gym_paid_id
  on public.payment_history (gym_id, paid_at desc, id desc);


-- ═══════════════════════════════════════════════════════════════════
-- 3. expenses — had NO indexes whatsoever
-- ═══════════════════════════════════════════════════════════════════
-- The expenses table is not created by any migration in this repo (see
-- the missing-migration note in supabase/migrations/README.md), so it
-- was never reviewed and never indexed. Every expense query was a full
-- table scan across ALL tenants: one gym opening Finance scanned every
-- other gym's expenses too.
create index if not exists idx_expenses_gym_date
  on public.expenses (gym_id, expense_date desc);

create index if not exists idx_expenses_gym_month
  on public.expenses (gym_id, expense_month);


-- ═══════════════════════════════════════════════════════════════════
-- 4. activity_log and enquiries
-- ═══════════════════════════════════════════════════════════════════
create index if not exists idx_activity_log_gym_created
  on public.activity_log (gym_id, created_at desc);

create index if not exists idx_enquiries_gym_created_active
  on public.enquiries (gym_id, created_at desc)
  where is_active = true;


-- 7. Schedule log cleanup properly (AUDIT.md A13)
-- ═══════════════════════════════════════════════════════════════════
-- cleanup_old_logs() has existed since migration 001 but was never
-- scheduled. In its absence, src/lib/members.js was firing a
-- "DELETE ... WHERE created_at < 90 days" from a random user's browser
-- on ~1% of member writes. That is an unpredictable full-table delete
-- triggered by whoever happens to be using the app. The client side of
-- that is removed in the matching commit; this is the replacement.
--
-- Guarded: if pg_cron is not installed (migration 032 installs it) this
-- warns instead of aborting the whole migration.
do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise warning '[sculpt] pg_cron not installed — skipping cleanup schedule. Run migration 032 first, then re-run this block.';
    return;
  end if;

  perform cron.unschedule('sculpt-cleanup-old-logs')
    where exists (select 1 from cron.job where jobname = 'sculpt-cleanup-old-logs');

  -- Sundays at 03:00 UTC (08:30 IST) — outside gym opening hours.
  perform cron.schedule('sculpt-cleanup-old-logs', '0 3 * * 0',
                        $cron$select public.cleanup_old_logs();$cron$);
end $$;

commit;


-- ═══════════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════════
-- 1. All eight indexes exist and are valid:
--      select indexrelid::regclass as idx, indisvalid
--        from pg_index
--       where indexrelid::regclass::text like 'idx_%'
--         and indexrelid::regclass::text in (
--           'idx_members_gym_join_active','idx_members_gym_expiry_live',
--           'idx_members_gym_paystatus_live','idx_members_gym_phone_active',
--           'idx_payment_history_gym_paid_id','idx_expenses_gym_date',
--           'idx_expenses_gym_month','idx_activity_log_gym_created',
--           'idx_enquiries_gym_created_active');
--    Expect 9 rows, indisvalid = true on every one.
--    (No CONCURRENTLY here means an invalid index is not possible —
--     a failure rolls the whole transaction back instead.)
--
-- 2. The members list query uses the new index:
--      explain analyze
--      select * from members
--       where gym_id = '<gym-id>' and is_active = true
--       order by join_date desc limit 50;
--    Expect "Index Scan using idx_members_gym_join_active".
--    Expect NO "Seq Scan on members" and NO separate "Sort" node.
--
-- 3. The revenue query uses the new index:
--      explain analyze
--      select * from payment_history
--       where gym_id = '<gym-id>'
--       order by paid_at desc, id desc limit 1000;
--    Expect "Index Scan using idx_payment_history_gym_paid_id".
--
-- 4. Broadcast default:
--      select column_default from information_schema.columns
--       where table_name = 'broadcasts' and column_name = 'cost_per_msg_paise';
--    Expect 150.
--
-- 5. Cancelled members are no longer queued for reminders — cancel a
--    member whose expiry is exactly 7 days away, then:
--      select * from get_due_reminders();
--    They must not appear.
--
-- 6. The cleanup job is scheduled:
--      select jobname, schedule, active from cron.job;
-- ═══════════════════════════════════════════════════════════════════
