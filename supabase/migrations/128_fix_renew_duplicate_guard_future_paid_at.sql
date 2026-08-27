-- 128_fix_renew_duplicate_guard_future_paid_at.sql
--
-- sculpt_renew_member's "reject an exact-repeat renewal fired again within
-- 5 seconds" guard (added as "Item 18", see the live function body before
-- this migration) compares wall-clock now() against payment_history.paid_at.
-- That works for sculpt_add_member and sculpt_clear_balance, whose paid_at
-- really is "now" at insert time — but src/lib/members.js's renewMember()
-- deliberately sets a renewal's paid_at to the renewal's *effective join
-- date* (toPaidAtTimestamp(r.joinDate)), not the actual submission time.
-- Renewing a still-active membership (the normal, encouraged case: renewing
-- before expiry) always computes a join_date in the future (the current
-- expiry date, pushed forward) — so its payment_history row's paid_at ends
-- up in the future too.
--
-- `paid_at >= now() - interval '5 seconds'` is true for ANY future paid_at,
-- forever, not just one inserted in the last 5 real seconds. The result:
-- once a member renews while still active, every later attempt to renew
-- them again at the same plan+price is permanently rejected as a "duplicate
-- renewal was already recorded a moment ago" — even weeks later, even
-- though nothing was actually duplicated. This blocks the single most
-- common renewal pattern (a repeat customer renewing the same plan every
-- cycle), not an edge case.
--
-- Fix: track real insertion time separately. payment_history gets a new
-- created_at column (defaults to now(), so every existing/future row not
-- touched by this migration keeps behaving exactly as before), and the
-- duplicate guard checks created_at instead of paid_at — genuinely "was
-- this exact RPC call fired again in the last 5 real seconds", regardless
-- of what effective date the payment itself is dated to.
--
-- Everything else in the function body is unchanged from the live version
-- (verified via pg_get_functiondef before writing this migration, per
-- CLAUDE.md's rule on copying a function body forward).

alter table public.payment_history
  add column if not exists created_at timestamptz not null default now();

create or replace function public.sculpt_renew_member(
  p_member_id uuid,
  p_gym_id uuid,
  p_plan_id uuid,
  p_plan_name text,
  p_plan_price numeric,
  p_plan_duration_months integer,
  p_join_date date,
  p_member_addons text,
  p_payment_mode text,
  p_payment_status text,
  p_member_type text,
  p_discount_amount numeric,
  p_balance_due numeric,
  p_amount_paid numeric,
  p_paid_at timestamp with time zone,
  p_payment_notes text
)
returns members
language plpgsql
as $function$
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
  -- Checks created_at (real insertion time), not paid_at (the renewal's
  -- effective date, which is routinely in the future) — see this
  -- migration's header for why paid_at broke this for every renewal of
  -- a still-active membership.
  if coalesce(p_amount_paid, 0) > 0 then
    select count(*) into v_dup_count
      from public.payment_history
     where member_id = p_member_id
       and gym_id = p_gym_id
       and amount = p_amount_paid
       and plan_id is not distinct from p_plan_id
       and created_at >= now() - interval '5 seconds';

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
$function$;
