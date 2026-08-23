-- ═══════════════════════════════════════════════════════════════
-- Migration 124 — renewing a member can silently fail to move
-- expiry_date when the computed renewal join_date happens to equal
-- the join_date already stored on the row
-- ═══════════════════════════════════════════════════════════════
-- Found verifying migration 122 end-to-end against the live DB (see
-- session notes): renewing an EXPIRED member whose join_date was
-- already today (e.g. a same-day trial-to-paid conversion, or a second
-- same-day renewal) computed the correct new join_date (today) — but
-- because that value happened to be IDENTICAL to the join_date already
-- on the row, set_member_expiry()'s "only recompute when join_date or
-- plan_duration_months actually changed" guard (migration 122) saw no
-- change and left expiry_date exactly as it was before the renewal.
-- The renewal payment was recorded and the UI reported success, but the
-- member's expiry never moved.
--
-- 122's guard exists so a genuine manual edit to expiry_date (typed
-- directly into the new Edit Member field) isn't clobbered when
-- join_date/duration are untouched. That's the right rule for a manual
-- edit from the UI — but sculpt_renew_member is not a manual edit: it
-- always knows the correct new expiry_date deterministically (join_date
-- + duration) and should never depend on the trigger noticing a change.
--
-- Fix: sculpt_renew_member now sets expiry_date explicitly in its own
-- UPDATE, the same formula the trigger uses. When the trigger's guard
-- does fire (the normal case — join_date actually changed) it
-- recomputes to the identical value, a no-op. When the guard doesn't
-- fire (the no-op-join_date edge case this migration fixes) the
-- explicitly-set value stands instead of silently reverting to the old
-- one. Manual expiry edits from the Edit Member modal are unaffected —
-- that code path still goes through plain updateMember(), never this
-- function.
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
  v_expiry date;
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

  -- Compute the new expiry deterministically here (same formula
  -- set_member_expiry() uses) rather than depending on the trigger
  -- noticing join_date changed — see header for why that dependency
  -- silently failed when it didn't change.
  v_expiry := case
    when p_member_type <> 'Trial' and p_plan_duration_months is not null and p_plan_duration_months > 0 and p_join_date is not null
      then (p_join_date + (p_plan_duration_months || ' months')::interval)::date
    else null
  end;

  update public.members
     set plan_id              = p_plan_id,
         plan_name            = p_plan_name,
         plan_price           = p_plan_price,
         plan_duration_months = p_plan_duration_months,
         join_date            = p_join_date,
         expiry_date          = coalesce(v_expiry, expiry_date),
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

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- Renew an already-expired member whose join_date is currently set to
-- TODAY (e.g. a member added earlier today, then immediately renewed) —
-- expiry_date must move to today + duration, not stay unchanged. This
-- is the exact case that shipped broken: renewing an expired member
-- whose stored join_date already equalled today left expiry_date
-- untouched even though the RPC reported success and recorded the
-- payment.
-- ═══════════════════════════════════════════════════════════════
