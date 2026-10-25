-- ═══════════════════════════════════════════════════════════════
-- Migration 134 — staff attendance is split into a MORNING and an
-- EVENING session, so a trainer who works both batches keeps both
-- ═══════════════════════════════════════════════════════════════
-- The gym runs two batches a day and trainers scan the desk QR for
-- each: in for the morning batch, out, then in again for the evening
-- batch, out. staff_attendance had one row per staff member per day
-- with a single check_in / check_out pair, and sculpt_staff_checkin
-- moved check_out forward on every scan past the first — so that day
-- read as "in 06:00, out 21:00", indistinguishable from a 15-hour
-- shift, and the owner could not see who actually covered which
-- batch (client request, 2026-10-25: "they need to track accurate
-- both mrng and evng, we need to split it").
--
-- Shape chosen: two more columns on the same per-day row, not a
-- second row per day.
--
--   check_in / check_out                  the MORNING session (existing
--                                         columns, existing data — every
--                                         row written so far was a
--                                         morning-or-whole-day record)
--   evening_check_in / evening_check_out  the EVENING session (new)
--
-- Keeping one row per (staff_id, date) leaves the unique constraint,
-- upsertAttendance()'s onConflict, the day-level `status`, salary and
-- analytics (which count days, not sessions) all untouched.
--
-- Which session a scan belongs to is decided by the clock, in the
-- gym's timezone, against gyms.batch_split_time (default 14:00): a
-- scan before it is morning, at/after it is evening. By the clock and
-- not by staff.batch (migration 133) on purpose — a Morning-tagged
-- trainer covering an evening must still land in the evening columns,
-- and an untagged one must still work. 14:00 sits in the dead
-- mid-afternoon gap between the two batches. Change it with
--   update gyms set batch_split_time = '13:00';
-- no code change needed.
--
-- Within a session the rules are exactly the old ones: the first scan
-- sets that session's in, every later scan (after the 10-minute
-- cooldown, measured within the same session) moves that session's
-- out. Times are truncated to whole seconds (see migration 131).
--
-- RETURNS TABLE (status, message) shadows staff_attendance.status
-- inside this plpgsql body (migration 111 / CLAUDE.md). The body
-- never names `status` in an expression — only in an INSERT column
-- list, which is not an ambiguity site — and the row is read via
-- SELECT * INTO a %ROWTYPE variable, same as 131.
--
-- Body copied forward from 131 (the current version), not an older
-- copy. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.staff_attendance
  add column if not exists evening_check_in  time,
  add column if not exists evening_check_out time;

comment on column public.staff_attendance.check_in is
  'Morning-session in time (scans before gyms.batch_split_time). Whole seconds.';
comment on column public.staff_attendance.check_out is
  'Morning-session out time. Whole seconds.';
comment on column public.staff_attendance.evening_check_in is
  'Evening-session in time (scans at/after gyms.batch_split_time). Whole seconds.';
comment on column public.staff_attendance.evening_check_out is
  'Evening-session out time. Whole seconds.';

alter table public.gyms
  add column if not exists batch_split_time time not null default '14:00';

comment on column public.gyms.batch_split_time is
  'Gym-local time that separates the morning and evening staff sessions in sculpt_staff_checkin.';

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
  v_split time;
  v_local_date date;
  v_local_time time;
  v_evening boolean;
  v_label text;
  v_row staff_attendance%ROWTYPE;
  v_in time;
  v_out time;
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

  SELECT timezone, batch_split_time INTO v_tz, v_split FROM gyms WHERE id = v_gym_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_split := COALESCE(v_split, '14:00'::time);
  v_local_date := (now() AT TIME ZONE v_tz)::date;

  -- date_trunc to the second is migration 131's fix. Do not simplify
  -- it back to a bare ::time cast.
  v_local_time := date_trunc('second', (now() AT TIME ZONE v_tz))::time;

  v_evening := v_local_time >= v_split;
  v_label := CASE WHEN v_evening THEN 'evening' ELSE 'morning' END;

  SELECT * INTO v_row
  FROM staff_attendance
  WHERE staff_id = v_staff_id AND date = v_local_date
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      IF v_evening THEN
        INSERT INTO staff_attendance (gym_id, staff_id, date, status, evening_check_in)
        VALUES (v_gym_id, v_staff_id, v_local_date, 'Present', v_local_time);
      ELSE
        INSERT INTO staff_attendance (gym_id, staff_id, date, status, check_in)
        VALUES (v_gym_id, v_staff_id, v_local_date, 'Present', v_local_time);
      END IF;
      RETURN QUERY SELECT 'CHECKED_IN', 'Checked in for the ' || v_label || ' batch.';
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- Two simultaneous first scans: the other transaction's INSERT
      -- won the (staff_id, date) race. Re-read the now-existing row
      -- under lock and fall through to the update path below.
      SELECT * INTO v_row
      FROM staff_attendance
      WHERE staff_id = v_staff_id AND date = v_local_date
      FOR UPDATE;
    END;
  END IF;

  IF v_evening THEN
    v_in := v_row.evening_check_in;  v_out := v_row.evening_check_out;
  ELSE
    v_in := v_row.check_in;          v_out := v_row.check_out;
  END IF;

  -- First scan of this session on a row that already exists (the
  -- other session created it, or the owner marked the day by hand):
  -- this is a check-in, not a check-out.
  IF v_in IS NULL THEN
    IF v_evening THEN
      UPDATE staff_attendance SET evening_check_in = v_local_time WHERE id = v_row.id;
    ELSE
      UPDATE staff_attendance SET check_in = v_local_time WHERE id = v_row.id;
    END IF;
    RETURN QUERY SELECT 'CHECKED_IN', 'Checked in for the ' || v_label || ' batch.';
    RETURN;
  END IF;

  -- Cooldown from whichever event of THIS session happened last, so a
  -- rapid double-scan can't move the out time twice in one walk-in.
  v_last_event := COALESCE(v_out, v_in);

  IF (v_local_time - v_last_event) < interval '10 minutes' THEN
    RETURN QUERY SELECT 'TOO_SOON', 'Already checked in a moment ago.';
    RETURN;
  END IF;

  IF v_evening THEN
    UPDATE staff_attendance SET evening_check_out = v_local_time WHERE id = v_row.id;
  ELSE
    UPDATE staff_attendance SET check_out = v_local_time WHERE id = v_row.id;
  END IF;
  RETURN QUERY SELECT 'CHECKED_OUT', 'Checked out of the ' || v_label || ' batch.';
END;
$$;

COMMENT ON FUNCTION sculpt_staff_checkin(text) IS
  'Staff/trainer scan of the desk QR. Resolves auth.uid() via staff.user_id, '
  'validates the token, and records the scan against the MORNING session '
  '(check_in/check_out) or the EVENING session (evening_check_in/'
  'evening_check_out) of today''s staff_attendance row, chosen by the '
  'gym-local clock against gyms.batch_split_time — see '
  '134_staff_attendance_batches.sql. First scan of a session = in, later '
  'scans move that session''s out, 10-minute cooldown per session. Times '
  'truncated to whole seconds (131). Upserts by hand (FOR UPDATE) and '
  'retries a concurrent-insert unique_violation as an update. Always returns '
  'a status; never raises for a business-logic rejection.';

REVOKE ALL ON FUNCTION sculpt_staff_checkin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_staff_checkin(text) TO authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- 1. select column_name from information_schema.columns
--    where table_name = 'staff_attendance' and column_name like 'evening_%';
--    -- two rows.
-- 2. As a staff login, scan before 14:00 gym time → "Checked in for the
--    morning batch"; scan again 10+ minutes later → "Checked out of the
--    morning batch". After 14:00 the same two scans fill the evening
--    pair and leave the morning pair untouched.
-- ═══════════════════════════════════════════════════════════════
