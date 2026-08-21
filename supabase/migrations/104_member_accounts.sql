-- ─────────────────────────────────────────────────────────────────
-- 104_member_accounts.sql
--
-- Member-account infrastructure: the auth link, auto-generated
-- application numbers, "added by" attribution, and login rate
-- limiting. Member row-level security itself (the narrow SELECT
-- policies) lands at the end of this file — see the delta spec at
-- docs/superpowers/specs/2026-08-21-checkin-portal-design.md for why
-- these are additive-only, never widening an existing policy.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

-- ── 1. Auth link + login flag ───────────────────────────────────
ALTER TABLE members ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE members ADD COLUMN IF NOT EXISTS login_enabled boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'members_user_id_unique'
      AND conrelid = 'public.members'::regclass
  ) THEN
    ALTER TABLE members ADD CONSTRAINT members_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- ── 2. "Added by" attribution ───────────────────────────────────
-- added_by_name is a snapshot taken at insert time, not a live join
-- through added_by_staff_id. Deactivating (or ON DELETE SET NULL-ing)
-- the staff row must not blank out who signed a member up historically
-- — see CHECKIN-PLAN delta spec point 3.
ALTER TABLE members ADD COLUMN IF NOT EXISTS added_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE members ADD COLUMN IF NOT EXISTS added_by_name text;

-- ── 3. Application-number sequence ──────────────────────────────
-- Per-gym counter, advanced with a plain UPDATE (which takes a row
-- lock) inside sculpt_generate_application_number below — that lock
-- is what stops two concurrent Add Member submissions from getting
-- the same sequence value; the 3-character random suffix on top is
-- what stops the number from being guessable at all, since there is
-- no second factor on the member login besides phone number.
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS next_application_seq int NOT NULL DEFAULT 0;

-- ── 4. Login attempt log (rate limiting) ────────────────────────
-- Written only by the member-signin Edge Function via the service
-- role. RLS is enabled with no policies at all — not even owner/staff
-- can read this table through the client; it exists purely so the
-- Edge Function can count recent failures per IP and per application
-- number. See supabase/functions/member-signin/index.ts.
CREATE TABLE IF NOT EXISTS member_login_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id             uuid REFERENCES gyms(id) ON DELETE CASCADE,
  application_number text,
  ip                 text,
  succeeded          boolean NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_login_attempts_appnum ON member_login_attempts (application_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_login_attempts_ip ON member_login_attempts (ip, created_at DESC);

ALTER TABLE member_login_attempts ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies — service_role bypasses RLS entirely,
-- which is the only writer/reader this table has.

-- ── 5. Helpers ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_member_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM members WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_my_member_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_member_id() TO authenticated;

-- Reserves and returns the next application number for a gym.
-- SECURITY DEFINER because it must UPDATE gyms.next_application_seq
-- regardless of caller — staff can SELECT but not UPDATE gyms
-- (migration 030 only grants staff a read policy there), and this
-- function needs to run for staff-initiated Add Member submissions
-- too. Everything else sculpt_add_member does still runs as the
-- caller, matching CLAUDE.md's "money functions run with the caller's
-- own permissions" rule — this helper only ever touches one counter
-- column, never member or payment data, so it's checked against the
-- caller's own gym below rather than trusted blindly.
CREATE OR REPLACE FUNCTION sculpt_generate_application_number(p_gym_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- no 0/O/1/I/L — easy to misread on a phone
  v_seq int;
  v_suffix text := '';
  v_bytes bytea;
  i int;
  v_authorized boolean;
BEGIN
  SELECT
    (get_my_gym_id_as_staff() = p_gym_id)
    OR EXISTS (SELECT 1 FROM gym_users WHERE user_id = auth.uid() AND gym_id = p_gym_id AND role = 'owner')
  INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE gyms SET next_application_seq = next_application_seq + 1
  WHERE id = p_gym_id
  RETURNING next_application_seq INTO v_seq;

  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'Gym not found.';
  END IF;

  v_bytes := gen_random_bytes(3);
  FOR i IN 0..2 LOOP
    v_suffix := v_suffix || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
  END LOOP;

  RETURN 'SC-' || lpad(v_seq::text, 4, '0') || '-' || v_suffix;
END;
$$;

REVOKE ALL ON FUNCTION sculpt_generate_application_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_generate_application_number(uuid) TO authenticated;

-- Deliberate reissue path for the rare case a number needs to change
-- (member lost their WhatsApp message and also forgot who to ask, a
-- duplicate got created, etc). Not security definer — the UPDATE on
-- members runs under the caller's own existing RLS (owner_all_own_members
-- / staff_update_members), only the sequence advance inside
-- sculpt_generate_application_number is elevated.
CREATE OR REPLACE FUNCTION sculpt_regenerate_application_number(p_member_id uuid, p_gym_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new text;
BEGIN
  v_new := sculpt_generate_application_number(p_gym_id);

  UPDATE members
  SET application_number = v_new
  WHERE id = p_member_id AND gym_id = p_gym_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found, or you do not have access to them.';
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION sculpt_regenerate_application_number(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_regenerate_application_number(uuid, uuid) TO authenticated;

-- ── 6. sculpt_add_member — auto-generate the application number ─
-- Adding p_added_by_staff_id / p_added_by_name changes the function's
-- signature, which CREATE OR REPLACE cannot do in place (Postgres
-- treats a changed argument list as a different function) — so the
-- old-signature version is dropped explicitly first, same as the
-- rename in 100_sculpt_rename_identifiers.sql being explicit rather
-- than implicit. p_application_number is kept as a parameter only so
-- old callers don't fail to resolve the overload; its value is never
-- used — the function always generates its own, because a typed
-- application number is exactly what the client conversation removed.
DROP FUNCTION IF EXISTS sculpt_add_member(
  uuid, uuid, text, text, text, date, text, date, uuid, text, numeric, int,
  text, date, text, text, text, text, text, text, numeric, numeric, numeric,
  timestamptz, text
);

CREATE FUNCTION sculpt_add_member(
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
  PERFORM public.flym_assert_payment_mode(p_payment_mode);

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

-- ── 7. Member row-level security (additive only) ────────────────
-- Every existing policy on these two tables is gym-wide
-- (gym_id = get_my_gym_id() / get_my_gym_id_as_staff()), which
-- evaluates to NULL/false for a member session — a member is never a
-- row in gym_users or staff, so none of those existing policies ever
-- match a member's session and none of them are touched here.
DROP POLICY IF EXISTS "member_read_own_row" ON members;
CREATE POLICY "member_read_own_row" ON members
  FOR SELECT USING (id = get_my_member_id());

DROP POLICY IF EXISTS "member_read_own_payments" ON payment_history;
CREATE POLICY "member_read_own_payments" ON payment_history
  FOR SELECT USING (member_id = get_my_member_id());

-- ── 8. Rebuild members_with_status ───────────────────────────────
-- `m.*` is expanded at view-creation time, so the four new columns
-- above (user_id, login_enabled, added_by_staff_id, added_by_name)
-- need the view rebuilt to appear — same DROP+CREATE this view has
-- needed after every column addition since migration 005.
DROP VIEW IF EXISTS members_with_status;
CREATE VIEW members_with_status
  WITH (security_invoker = true)
AS
SELECT
  m.*,
  CASE
    WHEN m.cancelled_at IS NOT NULL                                      THEN 'Cancelled'
    WHEN m.member_type = 'Trial' AND m.expiry_date IS NOT NULL
         AND m.expiry_date < CURRENT_DATE                                THEN 'Expired'
    WHEN m.member_type = 'Trial'                                         THEN 'Trial'
    WHEN m.expiry_date IS NOT NULL AND m.expiry_date < CURRENT_DATE      THEN 'Expired'
    WHEN m.expiry_date IS NOT NULL
         AND m.expiry_date <= CURRENT_DATE + INTERVAL '7 days'           THEN 'Expiring'
    WHEN m.payment_status = 'Due'                                        THEN 'Due'
    ELSE 'Active'
  END AS computed_status,
  CASE
    WHEN m.expiry_date IS NOT NULL
    THEN (m.expiry_date - CURRENT_DATE)
    ELSE NULL
  END AS days_until_expiry
FROM members m
WHERE m.is_active = TRUE;

GRANT SELECT ON members_with_status TO authenticated;
