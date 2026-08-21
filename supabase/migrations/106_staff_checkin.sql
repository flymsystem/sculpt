-- ─────────────────────────────────────────────────────────────────
-- 106_staff_checkin.sql
--
-- Staff/trainer scan of the desk QR upserts today's staff_attendance
-- row: first scan of the day sets check_in, a second scan at least
-- 10 minutes later sets check_out, anything in between is a no-op.
-- This turns staff attendance from manual entry into a side-effect of
-- walking in the door.
--
-- MUST RETURN, NEVER RAISE for an invalid/expired token or a
-- not-a-staff-member caller: a RAISE rolls back inside a transaction
-- and (for the member function landing in migration 107) would
-- destroy the denied-attempt record it was supposed to leave behind.
-- Kept consistent here even though staff check-in writes no "denied"
-- row today, so the two functions read the same way.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sculpt_staff_checkin(p_token text)
RETURNS TABLE (status text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_id uuid;
  v_gym_id uuid;
  v_token_gym_id uuid;
  v_tz text;
  v_local_date date;
  v_local_time time;
  v_row staff_attendance%ROWTYPE;
BEGIN
  SELECT id, gym_id INTO v_staff_id, v_gym_id
  FROM staff
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_STAFF', 'This account is not an active staff member.';
    RETURN;
  END IF;

  SELECT gym_id INTO v_token_gym_id
  FROM checkin_tokens
  WHERE token = p_token AND expires_at > now();

  IF v_token_gym_id IS NULL THEN
    RETURN QUERY SELECT 'INVALID_TOKEN', 'This code has expired. Ask the desk to refresh it.';
    RETURN;
  END IF;

  IF v_token_gym_id <> v_gym_id THEN
    RETURN QUERY SELECT 'INVALID_TOKEN', 'This code belongs to a different gym.';
    RETURN;
  END IF;

  SELECT timezone INTO v_tz FROM gyms WHERE id = v_gym_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_local_date := (now() AT TIME ZONE v_tz)::date;
  v_local_time := (now() AT TIME ZONE v_tz)::time;

  SELECT * INTO v_row
  FROM staff_attendance
  WHERE staff_id = v_staff_id AND date = v_local_date
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO staff_attendance (gym_id, staff_id, date, status, check_in)
    VALUES (v_gym_id, v_staff_id, v_local_date, 'Present', v_local_time);
    RETURN QUERY SELECT 'CHECKED_IN', 'Checked in.';
    RETURN;
  END IF;

  IF v_row.check_out IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_DONE', 'Already checked in and out today.';
    RETURN;
  END IF;

  IF v_row.check_in IS NOT NULL
     AND (v_local_time - v_row.check_in) < interval '10 minutes' THEN
    RETURN QUERY SELECT 'TOO_SOON', 'Already checked in a moment ago.';
    RETURN;
  END IF;

  UPDATE staff_attendance
  SET check_out = v_local_time
  WHERE id = v_row.id;
  RETURN QUERY SELECT 'CHECKED_OUT', 'Checked out.';
END;
$$;

COMMENT ON FUNCTION sculpt_staff_checkin(text) IS
  'Staff/trainer scan of the desk QR. Resolves auth.uid() via staff.user_id, '
  'validates the token, and upserts today''s staff_attendance row by hand '
  '(FOR UPDATE, not ON CONFLICT) so the 10-minute too-soon check can read '
  'the existing row first. Always returns a status; never raises for a '
  'business-logic rejection.';

REVOKE ALL ON FUNCTION sculpt_staff_checkin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_staff_checkin(text) TO authenticated;
