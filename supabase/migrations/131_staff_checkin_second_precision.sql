-- ═══════════════════════════════════════════════════════════════
-- Migration 131 — staff check-in times were written at a precision
-- the UI physically cannot display, so every scanned time read back
-- as blank and the next "Save Attendance" wrote NULL over it
-- ═══════════════════════════════════════════════════════════════
-- staff_attendance.check_in / check_out are `time without time zone`
-- (full microsecond precision), and sculpt_staff_checkin wrote
-- `(now() AT TIME ZONE v_tz)::time` straight into them — e.g.
-- 06:07:23.481712. The write was correct; nothing downstream could
-- read it.
--
-- The one and only place these two columns are ever displayed is the
-- Daily Attendance grid (src/pages/dashboard/staff.js), which renders
-- them into <input type="time" value="..."> . HTML's value-sanitization
-- algorithm accepts at most THREE fractional-second digits, so a
-- six-digit value is not a valid time string and the browser silently
-- replaces it with the empty string. Verified in Chromium, not
-- inferred from the spec:
--
--   value="06:07:23.481712" -> ""          <- what this function wrote
--   value="06:07:23"        -> "06:07:23"
--   value="06:07"           -> "06:07"
--
-- So a staff member scanned, the row was created with status
-- 'Present' and a real check_in, and the owner saw "Present" with an
-- empty time next to it. Worse, saveAllAttendance() then read those
-- now-empty inputs back and upsertAttendance() wrote check_in = NULL,
-- check_out = NULL over the genuine scan — the data was destroyed by
-- the act of opening the page and pressing Save.
--
-- Fixed at the source: truncate to whole seconds on write. Seconds are
-- already more precision than an attendance register needs, and the
-- app's own manual marking is minute-granularity. The client also
-- normalizes defensively (staff.js), because rows written before this
-- migration ran are not the only way a microsecond-precision value
-- could reach that input.
--
-- The backfill below repairs existing rows. It cannot recover times
-- that were already NULLed by a Save — those are gone.
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

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
  v_last_event time;
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

  -- date_trunc to the second is THE fix this migration exists for.
  -- Do not simplify it back to a bare ::time cast — see the header.
  v_local_time := date_trunc('second', (now() AT TIME ZONE v_tz))::time;

  SELECT * INTO v_row
  FROM staff_attendance
  WHERE staff_id = v_staff_id AND date = v_local_date
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO staff_attendance (gym_id, staff_id, date, status, check_in)
      VALUES (v_gym_id, v_staff_id, v_local_date, 'Present', v_local_time);
      RETURN QUERY SELECT 'CHECKED_IN', 'Checked in.';
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- Two simultaneous first scans: the other transaction's INSERT
      -- won the (staff_id, date) race and committed in the gap between
      -- our FOR UPDATE (which found nothing, because the row didn't
      -- exist yet) and our own INSERT. Re-read the now-existing row
      -- under lock and fall through to the update path below instead
      -- of surfacing the constraint error.
      SELECT * INTO v_row
      FROM staff_attendance
      WHERE staff_id = v_staff_id AND date = v_local_date
      FOR UPDATE;
    END;
  END IF;

  -- Cooldown is measured from whichever event happened more recently
  -- today — check_out if this isn't the first update, otherwise
  -- check_in — so a rapid double-scan can't move check_out twice in
  -- the same walk-in.
  v_last_event := COALESCE(v_row.check_out, v_row.check_in);

  IF v_last_event IS NOT NULL AND (v_local_time - v_last_event) < interval '10 minutes' THEN
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
  '(FOR UPDATE, not ON CONFLICT) so the 10-minute cooldown check can read '
  'the existing row first. Times are truncated to whole seconds on write: '
  'microsecond precision is not a valid HTML time-input value and was '
  'silently blanked by the browser, which is what made scanned attendance '
  'read back empty — see 131_staff_checkin_second_precision.sql. Every scan '
  'past the first moves check_out forward, not just the second — there is no '
  'terminal "done for today" state. A unique_violation on concurrent '
  'first-inserts is caught and retried as an update, not raised. Always '
  'returns a status; never raises for a business-logic rejection.';

REVOKE ALL ON FUNCTION sculpt_staff_checkin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_staff_checkin(text) TO authenticated;

-- ── Backfill ────────────────────────────────────────────────────
-- Repairs rows already written with sub-second precision. Idempotent:
-- the WHERE clause means a second run matches nothing at all.
UPDATE staff_attendance
SET check_in  = date_trunc('second', check_in)::time,
    check_out = date_trunc('second', check_out)::time
WHERE (check_in  IS NOT NULL AND date_trunc('second', check_in)::time  <> check_in)
   OR (check_out IS NOT NULL AND date_trunc('second', check_out)::time <> check_out);

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- 1. SELECT check_in, check_out FROM staff_attendance
--    WHERE check_in IS NOT NULL LIMIT 20;
--    -- every value ends in whole seconds, no fractional part.
-- 2. As a real staff login, scan the desk QR, then open
--    Staff -> Daily Attendance for today as the owner: the Check In
--    box must show the time, not be empty. That empty box was the bug.
-- 3. Press Save Attendance on that page and re-query the row — the
--    time must survive. Before this fix it became NULL.
-- ═══════════════════════════════════════════════════════════════
