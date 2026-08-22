-- ═══════════════════════════════════════════════════════════════
-- Migration 114 — sculpt_add_member called a helper name that no
-- longer exists
-- ═══════════════════════════════════════════════════════════════
-- Adding a member from the dashboard failed with:
--   Could not save this member: the sculpt_add_member database
--   function does not exist. Server said: function
--   public.flym_assert_payment_mode(text) does not exist
--
-- sculpt_add_member DOES exist (27 arguments, created in
-- 104_member_accounts.sql) — the error was misleading (see the
-- src/lib/members.js fix in the same commit). The real problem is
-- inside its body.
--
-- ROOT CAUSE: 100_sculpt_rename_identifiers.sql renamed every
-- pg_proc function matching flym_% to sculpt_% — including the
-- shared payment-mode guard, flym_assert_payment_mode ->
-- sculpt_assert_payment_mode. That rename ran against whatever
-- existed in the database at the time, which is correct.
--
-- 104_member_accounts.sql runs AFTER 100 (104 > 100) and defines a
-- brand new sculpt_add_member (it DROPs the old 25-arg signature
-- and CREATEs a new 27-arg one, to add p_added_by_staff_id /
-- p_added_by_name — see that file's own comment). Its body was
-- written by copying the pre-rename flym_add_member source and
-- updating the *function's own* name, but one internal call was
-- left pointing at the pre-rename helper name:
--   PERFORM public.flym_assert_payment_mode(p_payment_mode);
-- By the time 104 runs, that name no longer exists in pg_proc — 100
-- already renamed it — so every call to sculpt_add_member fails at
-- that line with 42883 ("function ... does not exist"), which
-- PostgREST reports back as if sculpt_add_member itself were
-- missing.
--
-- FIX: point the call at the helper's real (post-100) name. Nothing
-- else in this function changes.
--
-- SWEEP: every other internal call in every migrated function was
-- audited for the same class of bug (a call to a name migration 100
-- renamed away, or to any other helper that was never created).
-- This was the only one found — see CLAUDE.md / the PR description
-- for the full list of functions checked.
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
  -- Was: PERFORM public.flym_assert_payment_mode(p_payment_mode);
  -- That name was renamed away by migration 100. See header.
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
    p_plan_id, p_plan_name, p_plan_price, p_plan_duration_months, p_member_addons,
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
-- select proname from pg_proc where proname = 'flym_assert_payment_mode';
--   -> 0 rows (confirms the old name really is gone)
-- select proname from pg_proc where proname = 'sculpt_assert_payment_mode';
--   -> 1 row
-- Then add a member through the dashboard (or call sculpt_add_member
-- directly with a valid payment_mode) and confirm it succeeds and
-- returns a non-null application_number.
-- ═══════════════════════════════════════════════════════════════
