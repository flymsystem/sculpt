-- ═══════════════════════════════════════════════════════════════
-- Migration 121 — deleting a member silently drops their historical
-- payments from every revenue total
-- ═══════════════════════════════════════════════════════════════
-- FIX-PROMPT.md item 12: "deletion must never destroy historical
-- finance/payment records... payments, invoices and revenue reports
-- stay intact and still reconcile." Member deletion is already a soft
-- delete (is_active = false, never a hard DELETE — see deleteMember()
-- in src/lib/members.js) so the payment_history rows themselves always
-- survived. The bug is that sculpt_revenue_summary, sculpt_revenue_monthly
-- and sculpt_revenue_rows all filter to `members.is_active = true`, so
-- the moment a member with payment history is deleted, their past
-- revenue vanishes from Finance/Overview/reports even though the rows
-- are still sitting in payment_history. A gym's lifetime revenue total
-- must not change just because someone was deleted afterwards.
--
-- getPaymentHistory() / getPaymentsByMonth() in src/lib/members.js have
-- the matching client-side bug (an `!inner` join filtered to
-- members.is_active = true) — fixed in the same commit as this migration.
--
-- The members LIST itself is unaffected by this migration — it never
-- queried these functions and correctly keeps excluding deleted members
-- via members_with_status / getMembers().
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sculpt_revenue_summary(
  p_gym_id uuid,
  p_start timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS TABLE(total_amount numeric, payment_count bigint, cash_amount numeric, card_amount numeric, online_amount numeric)
LANGUAGE sql STABLE
AS $$
  select
    coalesce(sum(ph.amount), 0)                                              as total_amount,
    count(*)                                                                 as payment_count,
    coalesce(sum(ph.amount) filter (where ph.payment_mode = 'Cash'),   0)    as cash_amount,
    coalesce(sum(ph.amount) filter (where ph.payment_mode = 'Card'),   0)    as card_amount,
    coalesce(sum(ph.amount) filter (where ph.payment_mode = 'Online'), 0)    as online_amount
  from public.payment_history ph
  where ph.gym_id = p_gym_id
    and (p_start is null or ph.paid_at >= p_start)
    and (p_end   is null or ph.paid_at <= p_end);
$$;

CREATE OR REPLACE FUNCTION public.sculpt_revenue_monthly(
  p_gym_id uuid, p_starts timestamp with time zone[], p_ends timestamp with time zone[]
) RETURNS TABLE(bucket_index integer, total_amount numeric, payment_count bigint)
LANGUAGE sql STABLE
AS $$
  select
    i::int                            as bucket_index,
    coalesce(sum(ph.amount), 0)       as total_amount,
    count(ph.id)                      as payment_count
  from generate_subscripts(p_starts, 1) as i
  left join public.payment_history ph
    on  ph.gym_id  = p_gym_id
    and ph.paid_at >= p_starts[i]
    and ph.paid_at <= p_ends[i]
  group by i
  order by i;
$$;

CREATE OR REPLACE FUNCTION public.sculpt_revenue_rows(
  p_gym_id uuid, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_limit integer DEFAULT 200, p_offset integer DEFAULT 0
) RETURNS TABLE(id uuid, member_id uuid, member_name text, amount numeric, payment_mode text, plan_name text, paid_at timestamp with time zone)
LANGUAGE sql STABLE
AS $$
  select ph.id, ph.member_id, coalesce(m.full_name, '(deleted member)'), ph.amount,
         ph.payment_mode, ph.plan_name, ph.paid_at
    from public.payment_history ph
    left join public.members m
      on m.id = ph.member_id
   where ph.gym_id = p_gym_id
     and (p_start is null or ph.paid_at >= p_start)
     and (p_end   is null or ph.paid_at <= p_end)
   order by ph.paid_at desc, ph.id desc
   limit  greatest(0, least(coalesce(p_limit, 200), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- Note a member's total lifetime payments, note the gym's total revenue
-- for the period covering their join date. Delete that member. Total
-- revenue for that period must be unchanged.
-- ═══════════════════════════════════════════════════════════════
