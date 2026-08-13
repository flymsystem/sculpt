-- ═══════════════════════════════════════════════════════════════════
-- Migration 035 — Server-side revenue aggregation
-- ═══════════════════════════════════════════════════════════════════
-- Fixes the performance half of AUDIT.md A1.
--
-- Hotfix 1 made revenue CORRECT by paging through every payment row
-- instead of capping at 1,000. That fixed the wrong numbers but made a
-- new problem obvious: a gym with 50,000 payments now downloads 50,000
-- rows to a phone in order to add them up. Postgres can do that sum in
-- single-digit milliseconds and return one row.
--
-- ── THE ONE RULE THESE FUNCTIONS FOLLOW ────────────────────────────
-- The CLIENT computes the period boundaries and passes them in as
-- timestamps. The server never works out what "this month" means.
--
-- That is deliberate. The client's period boundaries are built from the
-- browser's local calendar (see getPeriodBounds in finance.js) and are
-- already correct for IST. If the server independently derived "this
-- month", the two would disagree at every boundary — around midnight,
-- on the 1st, and across DST-free-but-offset timezones — and revenue
-- figures would shift depending on which code path produced them. That
-- class of bug is very hard to see and very expensive to be wrong about.
-- Passing the boundaries in makes drift structurally impossible.
--
-- NULL bounds mean "no bound", matching the client's "All Time" period.
--
-- ── FILTER PARITY ──────────────────────────────────────────────────
-- These reproduce exactly what the JS was doing:
--   .eq('gym_id', gymId)                  → ph.gym_id = p_gym_id
--   members!inner(...) + members.is_active → exists(active member)
--   d >= start && d <= end                 → inclusive on BOTH ends
-- Soft-deleted members' payments stay excluded from revenue, as before.
--
-- Not SECURITY DEFINER — they run as the caller so RLS applies, same
-- reasoning as migration 033.
--
-- Depends on: 034 (idx_payment_history_gym_paid_id)
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════
-- 1. flym_revenue_summary — headline totals for one period
-- ═══════════════════════════════════════════════════════════════════
-- Replaces four full-array JS reduces per Finance render (total, cash,
-- card, online) plus a count, for both the current and previous period.
create or replace function public.flym_revenue_summary(
  p_gym_id uuid,
  p_start  timestamptz default null,
  p_end    timestamptz default null
)
returns table (
  total_amount   numeric,
  payment_count  bigint,
  cash_amount    numeric,
  card_amount    numeric,
  online_amount  numeric
)
language sql
stable
as $$
  select
    coalesce(sum(ph.amount), 0)                                              as total_amount,
    count(*)                                                                 as payment_count,
    coalesce(sum(ph.amount) filter (where ph.payment_mode = 'Cash'),   0)    as cash_amount,
    coalesce(sum(ph.amount) filter (where ph.payment_mode = 'Card'),   0)    as card_amount,
    coalesce(sum(ph.amount) filter (where ph.payment_mode = 'Online'), 0)    as online_amount
  from public.payment_history ph
  where ph.gym_id = p_gym_id
    and (p_start is null or ph.paid_at >= p_start)
    and (p_end   is null or ph.paid_at <= p_end)
    and exists (
      select 1 from public.members m
       where m.id = ph.member_id
         and m.is_active = true
    );
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 2. flym_revenue_monthly — the 6-month bar chart, in one round trip
-- ═══════════════════════════════════════════════════════════════════
-- Takes matched arrays of bucket starts and ends, again computed by the
-- client so month boundaries can't drift. Returns one row per bucket,
-- including empty ones (the LEFT JOIN matters — a month with no revenue
-- must come back as 0, not be missing, or the chart mislabels itself).
create or replace function public.flym_revenue_monthly(
  p_gym_id uuid,
  p_starts timestamptz[],
  p_ends   timestamptz[]
)
returns table (
  bucket_index  int,
  total_amount  numeric,
  payment_count bigint
)
language sql
stable
as $$
  select
    i::int                            as bucket_index,
    coalesce(sum(ph.amount), 0)       as total_amount,
    count(ph.id)                      as payment_count
  from generate_subscripts(p_starts, 1) as i
  left join public.payment_history ph
    on  ph.gym_id  = p_gym_id
    and ph.paid_at >= p_starts[i]
    and ph.paid_at <= p_ends[i]
    and exists (
      select 1 from public.members m
       where m.id = ph.member_id
         and m.is_active = true
    )
  group by i
  order by i;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 3. flym_revenue_rows — one page of the drill-down table
-- ═══════════════════════════════════════════════════════════════════
-- The Finance revenue breakdown shows at most 200 rows. It was slicing
-- those 200 out of an array of every payment the gym had ever taken.
create or replace function public.flym_revenue_rows(
  p_gym_id uuid,
  p_start  timestamptz default null,
  p_end    timestamptz default null,
  p_limit  int default 200,
  p_offset int default 0
)
returns table (
  id           uuid,
  member_id    uuid,
  member_name  text,
  amount       numeric,
  payment_mode text,
  plan_name    text,
  paid_at      timestamptz
)
language sql
stable
as $$
  select ph.id, ph.member_id, m.full_name, ph.amount,
         ph.payment_mode, ph.plan_name, ph.paid_at
    from public.payment_history ph
    join public.members m
      on m.id = ph.member_id
     and m.is_active = true
   where ph.gym_id = p_gym_id
     and (p_start is null or ph.paid_at >= p_start)
     and (p_end   is null or ph.paid_at <= p_end)
   order by ph.paid_at desc, ph.id desc
   limit  greatest(0, least(coalesce(p_limit, 200), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$$;


-- ── Grants ─────────────────────────────────────────────────────────
grant execute on function public.flym_revenue_summary(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.flym_revenue_monthly(uuid, timestamptz[], timestamptz[]) to authenticated;
grant execute on function public.flym_revenue_rows(uuid, timestamptz, timestamptz, int, int) to authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════════
-- 1. The summary must equal the old client-side sum exactly:
--      select * from flym_revenue_summary('<gym-id>');   -- all time
--      -- compare against:
--      select coalesce(sum(ph.amount),0), count(*)
--        from payment_history ph
--        join members m on m.id = ph.member_id and m.is_active
--       where ph.gym_id = '<gym-id>';
--    Both numbers must match, and both must match Finance -> All Time
--    in the app.
--
-- 2. Soft-deleted members stay excluded:
--    set a member is_active=false, re-run the summary, confirm the total
--    drops by exactly that member's recorded payments.
--
-- 3. Empty months still return a row:
--      select * from flym_revenue_monthly('<gym-id>',
--        array['2019-01-01'::timestamptz, '2019-02-01'::timestamptz],
--        array['2019-01-31 23:59:59'::timestamptz, '2019-02-28 23:59:59'::timestamptz]);
--    Expect 2 rows with totals of 0, not zero rows.
--
-- 4. Tenant isolation: call flym_revenue_summary with another gym's id.
--    Expect zeros (RLS hides their payment rows), never their revenue.
-- ═══════════════════════════════════════════════════════════════════
