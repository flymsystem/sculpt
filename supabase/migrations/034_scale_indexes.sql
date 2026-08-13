-- ═══════════════════════════════════════════════════════════════════
-- Migration 034 — Indexes that match the queries, plus small fixes
-- ═══════════════════════════════════════════════════════════════════
-- Fixes AUDIT.md A9 (missing composite indexes), A13 (log pruning),
-- B6 (reminders chase cancelled members) and B8 (broadcast cost default).
--
-- ── ⚠️ THIS FILE MUST NOT BE WRAPPED IN A TRANSACTION ──────────────
-- `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block.
-- There is deliberately no `begin;` / `commit;` here. Run it as-is in
-- the Supabase SQL editor, or with `psql -f`. Every statement is
-- idempotent (`if not exists` / `or replace`), so if it stops partway
-- you can simply run it again.
--
-- CONCURRENTLY is used because these tables are live: a plain
-- CREATE INDEX takes an ACCESS EXCLUSIVE lock and would freeze every
-- gym's dashboard for the duration of the build.
--
-- ── IF A CONCURRENT BUILD FAILS ────────────────────────────────────
-- A failed CONCURRENTLY build leaves an INVALID index behind that will
-- never be used and still costs write time. Find and drop any:
--
--   select indexrelid::regclass as idx
--     from pg_index where not indisvalid;
--   -- then, for each:  drop index concurrently <idx>;
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


-- ═══════════════════════════════════════════════════════════════════
-- 1. members
-- ═══════════════════════════════════════════════════════════════════

-- getMembers() / members_with_status:
--   WHERE gym_id = $1 AND is_active ORDER BY join_date DESC
create index concurrently if not exists idx_members_gym_join_active
  on public.members (gym_id, join_date desc)
  where is_active = true;

-- Alerts, notification generation, and the reminder queue all ask
-- "who in this gym expires around now", always excluding cancelled.
--   generate-notifications: gym_id + is_active + cancelled_at is null
--   send-reminders:         gym_id + expiry_date + is_active + cancelled
create index concurrently if not exists idx_members_gym_expiry_live
  on public.members (gym_id, expiry_date)
  where is_active = true and cancelled_at is null;

-- Pending-dues queries (Finance, Alerts, Overview).
create index concurrently if not exists idx_members_gym_paystatus_live
  on public.members (gym_id, payment_status)
  where is_active = true and cancelled_at is null;

-- checkDuplicatePhone(): gym_id + is_active + phone in (...).
-- Supersedes idx_members_phone from 023, which had no gym_id and so
-- had to scan matching phones across every tenant.
create index concurrently if not exists idx_members_gym_phone_active
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
create index concurrently if not exists idx_payment_history_gym_paid_id
  on public.payment_history (gym_id, paid_at desc, id desc);


-- ═══════════════════════════════════════════════════════════════════
-- 3. expenses — had NO indexes whatsoever
-- ═══════════════════════════════════════════════════════════════════
-- The expenses table is not created by any migration in this repo (see
-- the missing-migration note in supabase/migrations/README.md), so it
-- was never reviewed and never indexed. Every expense query was a full
-- table scan across ALL tenants: one gym opening Finance scanned every
-- other gym's expenses too.
create index concurrently if not exists idx_expenses_gym_date
  on public.expenses (gym_id, expense_date desc);

create index concurrently if not exists idx_expenses_gym_month
  on public.expenses (gym_id, expense_month);


-- ═══════════════════════════════════════════════════════════════════
-- 4. activity_log and enquiries
-- ═══════════════════════════════════════════════════════════════════
create index concurrently if not exists idx_activity_log_gym_created
  on public.activity_log (gym_id, created_at desc);

create index concurrently if not exists idx_enquiries_gym_created_active
  on public.enquiries (gym_id, created_at desc)
  where is_active = true;


-- ═══════════════════════════════════════════════════════════════════
-- 5. Broadcast cost default (AUDIT.md B8)
-- ═══════════════════════════════════════════════════════════════════
-- COST_PER_MSG_PAISE is 150 in src/lib/broadcast.js and in
-- create-broadcast-order/index.ts, but migration 025 set the column
-- default to 90. The Edge Function always writes 150 explicitly so live
-- billing is correct today, but any row inserted without the column —
-- or any reporting built on the default — would be wrong.
alter table public.broadcasts
  alter column cost_per_msg_paise set default 150;


-- ═══════════════════════════════════════════════════════════════════
-- 6. get_due_reminders() must not chase cancelled members
-- ═══════════════════════════════════════════════════════════════════
-- AUDIT.md B6. Migration 007 filtered m.is_active but predates
-- cancelled_at (migration 015), so a member who cancelled their
-- membership still received "please renew" WhatsApps. Cancelled members
-- are excluded from revenue, dues, broadcasts and notifications
-- everywhere else; this brings reminders in line.
--
-- Body is otherwise identical to migration 007.
create or replace function get_due_reminders()
returns table (
  gym_id          uuid,
  gym_name        text,
  member_id       uuid,
  member_name     text,
  phone           text,
  plan_name       text,
  expiry_date     date,
  window_days     int,
  wa_template     text
)
language sql stable security definer
set search_path = public
as $$
  with today as (
    select (now() at time zone 'Asia/Kolkata')::date as d
  )
  -- 7-day reminders
  select g.id, g.name, m.id, m.full_name, m.phone,
         coalesce(m.plan_name, 'membership'), m.expiry_date, 7, g.wa_template
    from members m
    join gyms g on g.id = m.gym_id, today
   where g.auto_reminders_enabled = true
     and g.is_active = true
     and m.is_active = true
     and m.cancelled_at is null
     and m.member_type != 'Trial'
     and m.phone is not null and m.phone <> ''
     and m.expiry_date is not null
     and m.expiry_date - today.d = 7
     and (m.last_reminder_7d_at is null or m.last_reminder_7d_at < today.d)
  union all
  -- 1-day reminders
  select g.id, g.name, m.id, m.full_name, m.phone,
         coalesce(m.plan_name, 'membership'), m.expiry_date, 1, g.wa_template
    from members m
    join gyms g on g.id = m.gym_id, today
   where g.auto_reminders_enabled = true
     and g.is_active = true
     and m.is_active = true
     and m.cancelled_at is null
     and m.member_type != 'Trial'
     and m.phone is not null and m.phone <> ''
     and m.expiry_date is not null
     and m.expiry_date - today.d = 1
     and (m.last_reminder_1d_at is null or m.last_reminder_1d_at < today.d);
$$;

grant execute on function get_due_reminders() to service_role;


-- ═══════════════════════════════════════════════════════════════════
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
    raise warning '[flym] pg_cron not installed — skipping cleanup schedule. Run migration 032 first, then re-run this block.';
    return;
  end if;

  perform cron.unschedule('flym-cleanup-old-logs')
    where exists (select 1 from cron.job where jobname = 'flym-cleanup-old-logs');

  -- Sundays at 03:00 UTC (08:30 IST) — outside gym opening hours.
  perform cron.schedule('flym-cleanup-old-logs', '0 3 * * 0',
                        $cron$select public.cleanup_old_logs();$cron$);
end $$;


-- ═══════════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════════
-- 1. No invalid indexes were left behind:
--      select indexrelid::regclass from pg_index where not indisvalid;
--    Expect zero rows.
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
