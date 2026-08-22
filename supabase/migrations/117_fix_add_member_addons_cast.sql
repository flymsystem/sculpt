-- ═══════════════════════════════════════════════════════════════
-- Migration 117 — sculpt_add_member reintroduced the member_addons
-- text→jsonb bug 038 already fixed once
-- ═══════════════════════════════════════════════════════════════
-- Found while verifying 114 against production: adding a member with
-- any member_addons value (including an explicit NULL passed as the
-- `text`-typed p_member_addons parameter — NULL doesn't exempt a
-- variable from needing the same assignment cast its non-null values
-- would) fails with:
--   column "member_addons" is of type jsonb but expression is of type text
--
-- ROOT CAUSE: 038_fix_member_addons_cast.sql fixed this exact error in
-- flym_add_member/flym_renew_member by routing p_member_addons through
-- flym_addons_to_jsonb() (renamed sculpt_addons_to_jsonb by migration
-- 100) before the INSERT/UPDATE. 104_member_accounts.sql then defined
-- a brand new sculpt_add_member (to add p_added_by_staff_id /
-- p_added_by_name — see that file's comment on why it's DROP + CREATE,
-- not CREATE OR REPLACE) by copying the OLDER, pre-038 function body —
-- the one that assigns p_member_addons straight into the INSERT
-- without the cast. The 038 fix was never carried forward into the
-- new function. sculpt_renew_member (still 038's version, untouched
-- by 104) was not affected.
--
-- FIX: same one-line change 038 made, applied to the current
-- sculpt_add_member (as fixed by 114 for the flym_assert_payment_mode
-- name). Nothing else in this function changes.
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sculpt_add_member(
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
  p_payment_notes        text,
  p_added_by_staff_id    uuid DEFAULT NULL,
  p_added_by_name        text DEFAULT NULL
)
RETURNS public.members
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.members;
  v_app_number text;
BEGIN
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required.';
  END IF;
  IF p_join_date IS NULL THEN
    RAISE EXCEPTION 'Join date is required.';
  END IF;
  PERFORM public.sculpt_assert_payment_mode(p_payment_mode);

  IF p_payment_status IS NULL OR p_payment_status NOT IN ('Paid', 'Due', 'Partial') THEN
    RAISE EXCEPTION 'Payment status must be Paid, Due or Partial (got %).', p_payment_status;
  END IF;
  IF p_member_type IS NULL OR p_member_type NOT IN ('Paid', 'Unpaid', 'Trial') THEN
    RAISE EXCEPTION 'Member type must be Paid, Unpaid or Trial (got %).', p_member_type;
  END IF;

  v_app_number := sculpt_generate_application_number(p_gym_id);

  INSERT INTO public.members (
    id, gym_id, full_name, phone, email, date_of_birth, gender, join_date,
    plan_id, plan_name, plan_price, plan_duration_months, member_addons,
    expiry_date, payment_mode, payment_status, member_type, notes,
    application_number, aadhar_number, discount_amount, balance_due,
    added_by_staff_id, added_by_name
  ) VALUES (
    p_id, p_gym_id, p_full_name, p_phone, p_email, p_date_of_birth, p_gender, p_join_date,
    p_plan_id, p_plan_name, p_plan_price, p_plan_duration_months,
    -- Was: p_member_addons (bare text). See header — this is 038's fix,
    -- lost when 104 copied the pre-038 body.
    public.sculpt_addons_to_jsonb(p_member_addons),
    CASE WHEN p_member_type = 'Trial' THEN p_expiry_date ELSE NULL END,
    p_payment_mode, p_payment_status, p_member_type, p_notes,
    v_app_number, p_aadhar_number,
    coalesce(p_discount_amount, 0), coalesce(p_balance_due, 0),
    p_added_by_staff_id, p_added_by_name
  )
  RETURNING * INTO v_row;

  IF coalesce(p_amount_paid, 0) > 0 AND p_member_type <> 'Trial' THEN
    INSERT INTO public.payment_history
      (gym_id, member_id, amount, payment_mode, plan_id, plan_name, paid_at, notes)
    VALUES
      (p_gym_id, v_row.id, p_amount_paid, coalesce(p_payment_mode, 'Cash'),
       p_plan_id, p_plan_name, coalesce(p_paid_at, now()), p_payment_notes);
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION sculpt_add_member(
  uuid, uuid, text, text, text, date, text, date, uuid, text, numeric, int,
  text, date, text, text, text, text, text, text, numeric, numeric, numeric,
  timestamptz, text, uuid, text
) TO authenticated;
REVOKE ALL ON FUNCTION sculpt_add_member(
  uuid, uuid, text, text, text, date, text, date, uuid, text, numeric, int,
  text, date, text, text, text, text, text, text, numeric, numeric, numeric,
  timestamptz, text, uuid, text
) FROM anon;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- Add a member through the dashboard with an add-on selected (or call
-- sculpt_add_member with p_member_addons := '[{"name":"Cardio","price":500}]')
-- and confirm it succeeds and members.member_addons stores the parsed
-- jsonb array, not a string. A NULL p_member_addons (no add-ons) must
-- also succeed — that was failing too, not just the non-null case.
-- ═══════════════════════════════════════════════════════════════
