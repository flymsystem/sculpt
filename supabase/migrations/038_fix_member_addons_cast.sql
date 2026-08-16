-- ═══════════════════════════════════════════════════════════════════
-- Migration 038 — Fix member_addons text→jsonb cast (production incident)
-- ═══════════════════════════════════════════════════════════════════
-- ROOT CAUSE:
-- Migration 011 converted members.member_addons from TEXT to JSONB.
-- Migration 033's flym_add_member / flym_renew_member RPCs declared
-- p_member_addons as `text` and assigned it directly to the jsonb
-- column, on the (incorrect) assumption that Postgres applies an
-- automatic assignment cast from text to jsonb. It does not — there is
-- no built-in assignment cast for text -> json/jsonb, only an explicit
-- one (`::jsonb`). Every Add Member and Renew Membership submission
-- that reached these RPCs has been failing since migration 033 was
-- applied, with:
--   column "member_addons" is of type jsonb but expression is of type text
--
-- Reproduced locally against a stub schema before writing this fix;
-- the error above is byte-for-byte what a plain `member_addons =
-- p_member_addons` assignment throws against a jsonb column.
--
-- FIX:
-- Route the text parameter through flym_addons_to_jsonb(), which casts
-- explicitly and turns NULL / blank / invalid JSON into a clean NULL
-- (or a clear error) instead of a cryptic Postgres type error.
--
-- Only the two functions below change. flym_clear_balance never
-- touches member_addons and is untouched.
-- ═══════════════════════════════════════════════════════════════════

begin;

create or replace function public.flym_addons_to_jsonb(p_value text)
returns jsonb
language plpgsql
immutable
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return p_value::jsonb;
exception when others then
  raise exception 'Add-ons could not be saved — invalid data format.';
end;
$$;

-- ── flym_renew_member — cast on the UPDATE ───────────────────────────
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
         member_addons        = public.flym_addons_to_jsonb(p_member_addons),
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

-- ── flym_add_member — cast on the INSERT ─────────────────────────────
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
    p_plan_id, p_plan_name, p_plan_price, p_plan_duration_months,
    public.flym_addons_to_jsonb(p_member_addons),
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
grant execute on function public.flym_addons_to_jsonb(text) to authenticated;
grant execute on function public.flym_renew_member(uuid, uuid, uuid, text, numeric, int, date, text, text, text, text, numeric, numeric, numeric, timestamptz, text) to authenticated;
grant execute on function public.flym_add_member(uuid, uuid, text, text, text, date, text, date, uuid, text, numeric, int, text, date, text, text, text, text, text, text, numeric, numeric, numeric, timestamptz, text) to authenticated;

revoke execute on function public.flym_addons_to_jsonb(text) from anon;
revoke execute on function public.flym_renew_member(uuid, uuid, uuid, text, numeric, int, date, text, text, text, text, numeric, numeric, numeric, timestamptz, text) from anon;
revoke execute on function public.flym_add_member(uuid, uuid, text, text, text, date, text, date, uuid, text, numeric, int, text, date, text, text, text, text, text, text, numeric, numeric, numeric, timestamptz, text) from anon;

commit;
