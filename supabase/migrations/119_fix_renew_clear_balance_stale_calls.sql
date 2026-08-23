-- ═══════════════════════════════════════════════════════════════
-- Migration 119 — sculpt_renew_member / sculpt_clear_balance call the
-- pre-rename flym_* helpers and have been failing on every call
-- ═══════════════════════════════════════════════════════════════
-- Same bug class as 114_fix_add_member_stale_helper_call.sql, found
-- while investigating FIX-PROMPT.md items 6, 8, 11, 18.
--
-- 100_sculpt_rename_identifiers.sql renamed flym_assert_payment_mode
-- and flym_addons_to_jsonb to sculpt_assert_payment_mode /
-- sculpt_addons_to_jsonb. 114 fixed the one stale call left inside
-- sculpt_add_member, but sculpt_renew_member (still calls both
-- flym_assert_payment_mode AND flym_addons_to_jsonb) and
-- sculpt_clear_balance (still calls flym_assert_payment_mode) were
-- never touched — see 000_baseline_current.sql lines ~876-926 and
-- ~484, which is a dump of what is actually live in production today.
--
-- IMPACT: every renewal and every balance-clear currently errors with
-- 42883 ("function flym_assert_payment_mode does not exist"). The
-- client's isMissingFunction() (src/lib/members.js) treats 42883 as
-- "migration not applied yet" and silently falls back to the pre-033
-- non-atomic JS path — so the feature still basically works, but
-- without the FOR UPDATE row lock or the single-transaction guarantee
-- HANDOVER.md §6 calls load-bearing for exactly this reason (a dropped
-- connection mid-write can extend a membership without recording the
-- payment, or the reverse, with nothing able to detect it afterwards).
-- It also means the row lock item 18 (rapid double renewal) depends on
-- was never actually running.
--
-- This migration also adds the item 18 guard: sculpt_renew_member now
-- rejects a renewal that exactly repeats one committed in the last 5
-- seconds for the same member (same plan + same amount) — a double
-- click or a retried request under a flaky connection, not a genuine
-- second renewal. Disable-on-submit (already in member-modals.js)
-- covers the common case; this is the DB-level backstop the ticket
-- asked for, since the row lock alone serialises concurrent calls but
-- does not deduplicate two calls that both go through.
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sculpt_renew_member(
  p_member_id uuid, p_gym_id uuid, p_plan_id uuid, p_plan_name text,
  p_plan_price numeric, p_plan_duration_months integer, p_join_date date,
  p_member_addons text, p_payment_mode text, p_payment_status text,
  p_member_type text, p_discount_amount numeric, p_balance_due numeric,
  p_amount_paid numeric, p_paid_at timestamp with time zone, p_payment_notes text
) RETURNS public.members
LANGUAGE plpgsql
AS $$
declare
  v_row public.members;
  v_dup_count int;
begin
  perform public.sculpt_assert_payment_mode(p_payment_mode);

  if p_payment_status is null or p_payment_status not in ('Paid', 'Due', 'Partial') then
    raise exception 'Payment status must be Paid, Due or Partial (got %).', p_payment_status;
  end if;
  if p_member_type is null or p_member_type not in ('Paid', 'Unpaid', 'Trial') then
    raise exception 'Member type must be Paid, Unpaid or Trial (got %).', p_member_type;
  end if;
  if p_amount_paid is not null and p_amount_paid < 0 then
    raise exception 'Amount paid cannot be negative.';
  end if;

  -- Lock first so a renewal and a balance collection can't interleave.
  perform 1 from public.members
   where id = p_member_id and gym_id = p_gym_id
   for update;

  if not found then
    raise exception 'Member not found, or you do not have access to them.';
  end if;

  -- Item 18 — reject an exact-repeat renewal fired again within 5
  -- seconds (double click / retried request), not a real second renewal.
  if coalesce(p_amount_paid, 0) > 0 then
    select count(*) into v_dup_count
      from public.payment_history
     where member_id = p_member_id
       and gym_id = p_gym_id
       and amount = p_amount_paid
       and plan_id is not distinct from p_plan_id
       and paid_at >= now() - interval '5 seconds';

    if v_dup_count > 0 then
      raise exception 'This renewal was already recorded a moment ago — check Finance before retrying.';
    end if;
  end if;

  update public.members
     set plan_id              = p_plan_id,
         plan_name            = p_plan_name,
         plan_price           = p_plan_price,
         plan_duration_months = p_plan_duration_months,
         join_date            = p_join_date,
         member_addons        = public.sculpt_addons_to_jsonb(p_member_addons),
         payment_mode         = p_payment_mode,
         payment_status       = p_payment_status,
         member_type          = p_member_type,
         discount_amount      = coalesce(p_discount_amount, 0),
         balance_due          = coalesce(p_balance_due, 0),
         cancelled_at         = null
   where id = p_member_id
     and gym_id = p_gym_id
  returning * into v_row;
  -- expiry_date is recomputed by the existing trg_member_expiry trigger.

  if coalesce(p_amount_paid, 0) > 0 then
    insert into public.payment_history
      (gym_id, member_id, amount, payment_mode, plan_id, plan_name, paid_at, notes)
    values
      (p_gym_id, p_member_id, p_amount_paid, coalesce(p_payment_mode, 'Cash'),
       p_plan_id, p_plan_name, coalesce(p_paid_at, now()),
       coalesce(p_payment_notes, 'Membership renewal'));
  end if;

  return v_row;
end;
$$;

CREATE OR REPLACE FUNCTION public.sculpt_clear_balance(
  p_member_id uuid, p_gym_id uuid, p_amount numeric, p_payment_mode text
) RETURNS public.members
LANGUAGE plpgsql
AS $$
declare
  v_row         public.members;
  v_current     numeric;
  v_new_balance numeric;
  v_new_status  text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  perform public.sculpt_assert_payment_mode(p_payment_mode);

  select * into v_row
    from public.members
   where id = p_member_id
     and gym_id = p_gym_id
   for update;

  if not found then
    raise exception 'Member not found, or you do not have access to them.';
  end if;

  v_current := coalesce(v_row.balance_due, 0);

  if p_amount > v_current then
    raise exception 'Amount cannot exceed the balance due (%).', v_current;
  end if;

  v_new_balance := round(v_current - p_amount, 2);
  v_new_status  := case when v_new_balance <= 0 then 'Paid' else 'Partial' end;

  update public.members
     set balance_due    = v_new_balance,
         payment_status = v_new_status
   where id = p_member_id
     and gym_id = p_gym_id
  returning * into v_row;

  insert into public.payment_history
    (gym_id, member_id, amount, payment_mode, plan_id, plan_name, notes)
  values
    (p_gym_id, p_member_id, p_amount, coalesce(p_payment_mode, 'Cash'),
     v_row.plan_id, v_row.plan_name, 'Balance payment');

  return v_row;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- 1. Renew an active member from the dashboard — must succeed without
--    falling back (check the browser network tab: the sculpt_renew_member
--    RPC call itself should return 200, not a 42883 caught client-side).
-- 2. Clear a balance — same check against sculpt_clear_balance.
-- 3. Click Renew twice fast on the same member with the same amount —
--    second call must fail with the "already recorded a moment ago"
--    message, and Finance must show exactly one new payment row, not two.
-- ═══════════════════════════════════════════════════════════════
