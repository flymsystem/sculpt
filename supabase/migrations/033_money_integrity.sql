-- ═══════════════════════════════════════════════════════════════════
-- Migration 033 — Transactional money operations
-- ═══════════════════════════════════════════════════════════════════
-- Fixes AUDIT.md B3 (non-atomic money writes) and B4 (lost updates).
--
-- ── THE PROBLEM ────────────────────────────────────────────────────
-- Adding a member, renewing a membership and clearing a balance each
-- performed TWO OR THREE separate HTTP writes from the phone:
--
--     add    : INSERT members            → INSERT payment_history
--     renew  : UPDATE members            → INSERT payment_history
--     clear  : SELECT + UPDATE members   → INSERT payment_history
--
-- There is no transaction across separate HTTP requests. On a cheap
-- Android on a weak connection — which is the entire target market —
-- the first write lands and the second does not. The membership moves
-- forward and the money vanishes from Finance, or the balance drops and
-- no payment is recorded. Nothing in the app can detect it afterwards:
-- the member record looks completely normal. The owner finds out at
-- month end when the books don't match the cash, with no way to tell
-- which record is wrong.
--
-- `clear` had a second, worse failure: read-modify-write. Two staff
-- collecting against the same member both read the old balance and the
-- second write silently overwrote the first.
--
-- ── THE FIX ────────────────────────────────────────────────────────
-- One function call per money operation. A function body is a single
-- transaction, so every statement inside commits together or not at all.
-- `SELECT … FOR UPDATE` serialises concurrent collections on the same
-- member.
--
-- ── WHY THESE ARE *NOT* SECURITY DEFINER ───────────────────────────
-- They run as the calling user, so the existing RLS policies on
-- `members` and `payment_history` apply unchanged — owners via
-- is_my_gym(), staff via get_my_gym_id_as_staff(), admins via
-- is_flym_admin(). No new privilege is created and no new bypass
-- exists. A SECURITY DEFINER function here would have had to
-- re-implement all of that authorisation by hand, and any mistake in it
-- would be a cross-tenant data leak. Letting RLS do its job is both
-- safer and less code.
--
-- ── COMPATIBILITY ──────────────────────────────────────────────────
-- Safe to apply while the old client is live. These are new functions;
-- nothing existing is altered or dropped. The client calls them and
-- automatically falls back to the old multi-step path if they are not
-- found, so applying this migration and deploying the frontend can
-- happen in either order.
--
-- `p_member_addons` is deliberately typed `text`, not `jsonb`. The
-- column may be `text` or `jsonb` depending on whether migration 011
-- was applied to this database, and assigning a text value to either
-- works via Postgres assignment casting — which is exactly what
-- PostgREST already does today. Typing it `jsonb` here would change
-- the stored shape on one of those two databases.
--
-- Value constraints are unchanged and are asserted, not redefined:
--   payment_mode   'Cash' | 'Online' | 'Card'
--   payment_status 'Paid' | 'Due'    | 'Partial'
--   member_type    'Paid' | 'Unpaid' | 'Trial'
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── Shared guard ───────────────────────────────────────────────────
create or replace function public.flym_assert_payment_mode(p_mode text)
returns void
language plpgsql
immutable
as $$
begin
  if p_mode is not null and p_mode not in ('Cash', 'Online', 'Card') then
    raise exception 'Payment mode must be Cash, Online or Card (got %).', p_mode;
  end if;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 1. flym_clear_balance — collect against an outstanding balance
-- ═══════════════════════════════════════════════════════════════════
-- Replaces: SELECT balance_due → compute in JS → UPDATE → INSERT.
-- FOR UPDATE holds the row until commit, so a second device collecting
-- at the same moment waits and then re-reads the *new* balance instead
-- of overwriting the first payment.
create or replace function public.flym_clear_balance(
  p_member_id    uuid,
  p_gym_id       uuid,
  p_amount       numeric,
  p_payment_mode text
)
returns public.members
language plpgsql
as $$
declare
  v_row         public.members;
  v_current     numeric;
  v_new_balance numeric;
  v_new_status  text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  perform public.flym_assert_payment_mode(p_payment_mode);

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


-- ═══════════════════════════════════════════════════════════════════
-- 2. flym_renew_member — renew a membership and record the payment
-- ═══════════════════════════════════════════════════════════════════
-- Renewal deliberately does NOT touch payment_history.paid_at on older
-- rows. A renewal creates a NEW payment; historic payments keep their
-- original dates. (This is what the client's skipPaidAtSync flag meant.)
--
-- cancelled_at is always cleared: renewing is what un-cancels a member.
create or replace function public.flym_renew_member(
  p_member_id            uuid,
  p_gym_id               uuid,
  p_plan_id              uuid,
  p_plan_name            text,
  p_plan_price           numeric,
  p_plan_duration_months int,
  p_join_date            date,
  p_member_addons        text,
  p_payment_mode         text,
  p_payment_status       text,
  p_member_type          text,
  p_discount_amount      numeric,
  p_balance_due          numeric,
  p_amount_paid          numeric,
  p_paid_at              timestamptz,
  p_payment_notes        text
)
returns public.members
language plpgsql
as $$
declare
  v_row public.members;
begin
  perform public.flym_assert_payment_mode(p_payment_mode);

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

  update public.members
     set plan_id              = p_plan_id,
         plan_name            = p_plan_name,
         plan_price           = p_plan_price,
         plan_duration_months = p_plan_duration_months,
         join_date            = p_join_date,
         member_addons        = p_member_addons,   -- assignment cast; see header
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


-- ═══════════════════════════════════════════════════════════════════
-- 3. flym_add_member — create a member and record the joining payment
-- ═══════════════════════════════════════════════════════════════════
-- p_id is the client-generated UUID that already acts as an idempotency
-- key: retrying a timed-out request hits the primary key instead of
-- creating a duplicate member. That behaviour is preserved — a retry
-- raises unique_violation, which the client reports as "already saved".
create or replace function public.flym_add_member(
  p_id                   uuid,
  p_gym_id               uuid,
  p_full_name            text,
  p_phone                text,
  p_email                text,
  p_date_of_birth        date,
  p_gender               text,
  p_join_date            date,
  p_plan_id              uuid,
  p_plan_name            text,
  p_plan_price           numeric,
  p_plan_duration_months int,
  p_member_addons        text,
  p_expiry_date          date,
  p_payment_mode         text,
  p_payment_status       text,
  p_member_type          text,
  p_notes                text,
  p_application_number   text,
  p_aadhar_number        text,
  p_discount_amount      numeric,
  p_balance_due          numeric,
  p_amount_paid          numeric,
  p_paid_at              timestamptz,
  p_payment_notes        text
)
returns public.members
language plpgsql
as $$
declare
  v_row public.members;
begin
  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'Full name is required.';
  end if;
  if p_join_date is null then
    raise exception 'Join date is required.';
  end if;
  perform public.flym_assert_payment_mode(p_payment_mode);

  if p_payment_status is null or p_payment_status not in ('Paid', 'Due', 'Partial') then
    raise exception 'Payment status must be Paid, Due or Partial (got %).', p_payment_status;
  end if;
  if p_member_type is null or p_member_type not in ('Paid', 'Unpaid', 'Trial') then
    raise exception 'Member type must be Paid, Unpaid or Trial (got %).', p_member_type;
  end if;

  insert into public.members (
    id, gym_id, full_name, phone, email, date_of_birth, gender, join_date,
    plan_id, plan_name, plan_price, plan_duration_months, member_addons,
    expiry_date, payment_mode, payment_status, member_type, notes,
    application_number, aadhar_number, discount_amount, balance_due
  ) values (
    p_id, p_gym_id, p_full_name, p_phone, p_email, p_date_of_birth, p_gender, p_join_date,
    p_plan_id, p_plan_name, p_plan_price, p_plan_duration_months, p_member_addons,
    -- Trial members carry an explicit expiry; for everyone else the
    -- trg_member_expiry trigger computes it from join_date + duration.
    case when p_member_type = 'Trial' then p_expiry_date else null end,
    p_payment_mode, p_payment_status, p_member_type, p_notes,
    p_application_number, p_aadhar_number,
    coalesce(p_discount_amount, 0), coalesce(p_balance_due, 0)
  )
  returning * into v_row;

  -- Trial members never generate a joining payment, matching the client.
  if coalesce(p_amount_paid, 0) > 0 and p_member_type <> 'Trial' then
    insert into public.payment_history
      (gym_id, member_id, amount, payment_mode, plan_id, plan_name, paid_at, notes)
    values
      (p_gym_id, v_row.id, p_amount_paid, coalesce(p_payment_mode, 'Cash'),
       p_plan_id, p_plan_name, coalesce(p_paid_at, now()), p_payment_notes);
  end if;

  return v_row;
end;
$$;


-- ── Grants ─────────────────────────────────────────────────────────
-- authenticated only. anon has no business writing money.
grant execute on function public.flym_clear_balance(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.flym_renew_member(uuid, uuid, uuid, text, numeric, int, date, text, text, text, text, numeric, numeric, numeric, timestamptz, text) to authenticated;
grant execute on function public.flym_add_member(uuid, uuid, text, text, text, date, text, date, uuid, text, numeric, int, text, date, text, text, text, text, text, text, numeric, numeric, numeric, timestamptz, text) to authenticated;

revoke execute on function public.flym_clear_balance(uuid, uuid, numeric, text) from anon;
revoke execute on function public.flym_renew_member(uuid, uuid, uuid, text, numeric, int, date, text, text, text, text, numeric, numeric, numeric, timestamptz, text) from anon;
revoke execute on function public.flym_add_member(uuid, uuid, text, text, text, date, text, date, uuid, text, numeric, int, text, date, text, text, text, text, text, text, numeric, numeric, numeric, timestamptz, text) from anon;

commit;

-- ═══════════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════════
-- 1. The functions exist and are NOT security definer:
--      select proname, prosecdef from pg_proc
--       where proname like 'flym\_%';
--    prosecdef must be false for all three.
--
-- 2. Atomicity — a rejected payment must leave nothing behind:
--      select balance_due from members where id = '<member>';
--      select flym_clear_balance('<member>', '<gym>', 999999, 'Cash');
--    Expect: "Amount cannot exceed the balance due". Then confirm
--    balance_due is unchanged and no payment_history row was created.
--
-- 3. Tenant isolation — this must fail, not succeed:
--      select flym_clear_balance('<member-in-another-gym>', '<their-gym>', 1, 'Cash');
--    Expect: "Member not found, or you do not have access to them."
-- ═══════════════════════════════════════════════════════════════════
