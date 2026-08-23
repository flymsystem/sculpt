-- ═══════════════════════════════════════════════════════════════
-- Migration 118 — duplicate phone numbers rejected at the DB level
-- ═══════════════════════════════════════════════════════════════
-- FIX-PROMPT.md item 2. The app already does a best-effort client-side
-- duplicate check (checkDuplicatePhone in src/lib/members.js) before
-- Add/Edit submit, but that is a read-then-write race: two staff
-- adding the same phone number within the same second both pass the
-- check and both insert. There was no DB-level constraint backing it.
--
-- Canonical storage format (decided, matches what the client already
-- writes on every Add/Edit save): '+91' followed by exactly 10 digits.
-- Legacy rows may not be in that exact shape (imported data, or rows
-- written before this convention existed) — normalise them first so
-- the uniqueness check actually catches format-different duplicates
-- like '9876543210' vs '+91 98765 43210'.
--
-- Reuse policy (client decision): a phone number freed by soft-deleting
-- a member (is_active = false) becomes reusable — the same pattern the
-- existing idx_members_gym_phone_active index already assumes. So the
-- unique index is scoped to is_active = true, matching that index.
--
-- Client decision: members.phone stays NULLABLE at the DB level — phone
-- is now required in the Add/Edit UI (member-modals.js), but existing
-- members who have no phone on file are left alone rather than backfilled
-- with a fake placeholder.
--
-- Safe to run more than once. If real duplicate active phone numbers
-- already exist in production, the unique index is skipped (not the
-- normalisation) and a NOTICE names how many groups need manual
-- resolution before re-running this file.
-- ═══════════════════════════════════════════════════════════════

-- ── Normalise existing phone values to the canonical +91XXXXXXXXXX form ──
UPDATE public.members
SET phone = '+91' || right(regexp_replace(phone, '\D', '', 'g'), 10)
WHERE phone IS NOT NULL
  AND length(regexp_replace(phone, '\D', '', 'g')) >= 10;

-- Blank strings (not NULL, but empty) are not a phone number.
UPDATE public.members SET phone = NULL WHERE phone = '';

-- Anything left that couldn't be normalised to 10 digits (garbage/legacy
-- partial data) is left as-is rather than guessed at or nulled out —
-- it will simply not match the unique index below.

DO $$
DECLARE
  dup_groups int;
BEGIN
  SELECT count(*) INTO dup_groups FROM (
    SELECT gym_id, phone
    FROM public.members
    WHERE is_active = true AND phone IS NOT NULL
    GROUP BY gym_id, phone
    HAVING count(*) > 1
  ) d;

  IF dup_groups > 0 THEN
    RAISE NOTICE 'Skipping ux_members_gym_phone_active: % duplicate active phone number group(s) found. Resolve them (SELECT gym_id, phone, count(*) FROM members WHERE is_active AND phone IS NOT NULL GROUP BY gym_id, phone HAVING count(*) > 1), then re-run this migration.', dup_groups;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS ux_members_gym_phone_active
      ON public.members (gym_id, phone)
      WHERE is_active = true AND phone IS NOT NULL;
  END IF;
END $$;

-- ── Friendly error on the insert path ───────────────────────────
-- sculpt_add_member is the only INSERT path into members (see CLAUDE.md).
-- Without this, a race that slips past the client-side check surfaces a
-- raw "duplicate key value violates unique constraint" to the UI.
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

  BEGIN
    INSERT INTO public.members (
      id, gym_id, full_name, phone, email, date_of_birth, gender, join_date,
      plan_id, plan_name, plan_price, plan_duration_months, member_addons,
      expiry_date, payment_mode, payment_status, member_type, notes,
      application_number, aadhar_number, discount_amount, balance_due,
      added_by_staff_id, added_by_name
    ) VALUES (
      p_id, p_gym_id, p_full_name, p_phone, p_email, p_date_of_birth, p_gender, p_join_date,
      p_plan_id, p_plan_name, p_plan_price, p_plan_duration_months,
      public.sculpt_addons_to_jsonb(p_member_addons),
      CASE WHEN p_member_type = 'Trial' THEN p_expiry_date ELSE NULL END,
      p_payment_mode, p_payment_status, p_member_type, p_notes,
      v_app_number, p_aadhar_number,
      coalesce(p_discount_amount, 0), coalesce(p_balance_due, 0),
      p_added_by_staff_id, p_added_by_name
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%ux_members_gym_phone_active%' THEN
      RAISE EXCEPTION 'This phone number is already registered to another member at this gym.';
    END IF;
    RAISE;
  END;

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
-- 1. SELECT count(*) FROM pg_indexes WHERE indexname = 'ux_members_gym_phone_active';
--    Should return 1. If 0, check the SQL editor's messages tab for the
--    "Skipping..." NOTICE and resolve the listed duplicates by hand.
-- 2. Add a member with a phone already used by another active member —
--    must fail with "This phone number is already registered..." not a
--    raw Postgres error.
-- 3. Soft-delete that member, then add a new member with the same phone —
--    must succeed (reuse allowed).
-- ═══════════════════════════════════════════════════════════════
