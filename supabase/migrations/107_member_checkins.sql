-- ─────────────────────────────────────────────────────────────────
-- 107_member_checkins.sql
--
-- The member-facing half of CHECKIN-PLAN.md §3.106: the check-ins
-- table, the member scan RPC, and a manual fallback for when the desk
-- tablet is offline (CHECKIN-PLAN §7 / HANDOVER.md §6).
--
-- MUST RETURN, NEVER RAISE — see CLAUDE.md's "Conventions" section.
-- A RAISE here rolls back the transaction and takes the denied-attempt
-- row with it, silently destroying the owner's renewal call list.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS checkin_grace_days int NOT NULL DEFAULT 0;
COMMENT ON COLUMN gyms.checkin_grace_days IS
  'Days past expiry_date a member is still let in. Client said block at '
  'the door; this exists so that can be softened later without a deploy.';

CREATE TABLE IF NOT EXISTS member_checkins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  local_date    date NOT NULL,
  status        text NOT NULL CHECK (status IN ('ok','denied_expired','denied_cancelled','denied_inactive')),
  source        text NOT NULL DEFAULT 'qr' CHECK (source IN ('qr','manual'))
);
CREATE INDEX IF NOT EXISTS idx_member_checkins_gym_time ON member_checkins (gym_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_checkins_member_time ON member_checkins (member_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_checkins_gym_date_ok ON member_checkins (gym_id, local_date) WHERE status = 'ok';

ALTER TABLE member_checkins ENABLE ROW LEVEL SECURITY;

-- No INSERT/UPDATE/DELETE policy for anyone — every write goes through
-- sculpt_member_checkin or sculpt_manual_checkin below, both SECURITY
-- DEFINER, which is what lets a denied attempt still get written even
-- though the member who triggered it has no INSERT rights of their own.
DROP POLICY IF EXISTS "owner_read_gym_checkins" ON member_checkins;
CREATE POLICY "owner_read_gym_checkins" ON member_checkins
  FOR SELECT USING (gym_id = get_my_gym_id());

DROP POLICY IF EXISTS "staff_read_gym_checkins" ON member_checkins;
CREATE POLICY "staff_read_gym_checkins" ON member_checkins
  FOR SELECT USING (gym_id = get_my_gym_id_as_staff());

DROP POLICY IF EXISTS "member_read_own_checkins" ON member_checkins;
CREATE POLICY "member_read_own_checkins" ON member_checkins
  FOR SELECT USING (member_id = get_my_member_id());

-- ── Member scan of the desk QR ────────────────────────────────────
CREATE OR REPLACE FUNCTION sculpt_member_checkin(p_token text)
RETURNS TABLE (status text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member record;
  v_token_gym_id uuid;
  v_tz text;
  v_grace_days int;
  v_local_date date;
  v_recent_ok boolean;
BEGIN
  SELECT id, gym_id, is_active, cancelled_at, expiry_date, login_enabled
  INTO v_member
  FROM members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_member.id IS NULL OR NOT v_member.login_enabled THEN
    RETURN QUERY SELECT 'NOT_A_MEMBER', 'This account is not recognised.';
    RETURN;
  END IF;

  SELECT gym_id INTO v_token_gym_id
  FROM checkin_tokens
  WHERE token = p_token AND expires_at > now();

  IF v_token_gym_id IS NULL OR v_token_gym_id <> v_member.gym_id THEN
    RETURN QUERY SELECT 'INVALID_TOKEN', 'This code has expired. Ask the desk to refresh it.';
    RETURN;
  END IF;

  SELECT timezone, checkin_grace_days INTO v_tz, v_grace_days
  FROM gyms WHERE id = v_member.gym_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_grace_days := COALESCE(v_grace_days, 0);
  v_local_date := (now() AT TIME ZONE v_tz)::date;

  -- Dedupe: one 'ok' row per member per 90 minutes, matching the
  -- staff re-scan cooldown's purpose (stop double-scan noise) without
  -- writing a second attendance record for a genuine second visit.
  SELECT EXISTS (
    SELECT 1 FROM member_checkins
    WHERE member_id = v_member.id AND status = 'ok'
      AND checked_in_at > now() - interval '90 minutes'
  ) INTO v_recent_ok;

  IF v_recent_ok THEN
    RETURN QUERY SELECT 'ALREADY_CHECKED_IN', 'Already checked in.';
    RETURN;
  END IF;

  IF NOT v_member.is_active THEN
    INSERT INTO member_checkins (gym_id, member_id, local_date, status)
    VALUES (v_member.gym_id, v_member.id, v_local_date, 'denied_inactive');
    RETURN QUERY SELECT 'DENIED_INACTIVE', 'Your membership is inactive. Please see the front desk.';
    RETURN;
  END IF;

  IF v_member.cancelled_at IS NOT NULL THEN
    INSERT INTO member_checkins (gym_id, member_id, local_date, status)
    VALUES (v_member.gym_id, v_member.id, v_local_date, 'denied_cancelled');
    RETURN QUERY SELECT 'DENIED_CANCELLED', 'Your membership was cancelled. Please see the front desk.';
    RETURN;
  END IF;

  IF v_member.expiry_date IS NOT NULL
     AND v_member.expiry_date < (v_local_date - v_grace_days) THEN
    INSERT INTO member_checkins (gym_id, member_id, local_date, status)
    VALUES (v_member.gym_id, v_member.id, v_local_date, 'denied_expired');
    RETURN QUERY SELECT 'DENIED_EXPIRED', 'Your membership has expired. Please renew at the front desk.';
    RETURN;
  END IF;

  INSERT INTO member_checkins (gym_id, member_id, local_date, status)
  VALUES (v_member.gym_id, v_member.id, v_local_date, 'ok');
  RETURN QUERY SELECT 'OK', 'Checked in. Have a great workout!';
END;
$$;

COMMENT ON FUNCTION sculpt_member_checkin(text) IS
  'Member scan of the desk QR. Always returns a status, never raises — a '
  'denied attempt (expired/cancelled/inactive) still writes a row, and '
  'that row is the owner''s renewal call list. Eligibility is computed in '
  'the gym''s own timezone, never CURRENT_DATE.';

REVOKE ALL ON FUNCTION sculpt_member_checkin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_member_checkin(text) TO authenticated;

-- ── Manual fallback (desk tablet offline) ─────────────────────────
-- Owner/staff only. No token involved — a human is making the call in
-- person, the same trust level as marking staff attendance by hand
-- already had before this feature existed. Still returns a status
-- rather than raising, so the UI has one response shape to handle
-- across both check-in paths.
CREATE OR REPLACE FUNCTION sculpt_manual_checkin(p_member_id uuid, p_gym_id uuid)
RETURNS TABLE (status text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorized boolean;
  v_member record;
  v_tz text;
  v_local_date date;
  v_recent_ok boolean;
BEGIN
  SELECT
    (get_my_gym_id_as_staff() = p_gym_id)
    OR EXISTS (SELECT 1 FROM gym_users WHERE user_id = auth.uid() AND gym_id = p_gym_id AND role = 'owner')
  INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN QUERY SELECT 'NOT_AUTHORIZED', 'You do not have access to check in members for this gym.';
    RETURN;
  END IF;

  SELECT id, gym_id, is_active INTO v_member
  FROM members
  WHERE id = p_member_id AND gym_id = p_gym_id;

  IF v_member.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND', 'Member not found.';
    RETURN;
  END IF;

  SELECT timezone INTO v_tz FROM gyms WHERE id = p_gym_id;
  v_local_date := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT EXISTS (
    SELECT 1 FROM member_checkins
    WHERE member_id = v_member.id AND status = 'ok'
      AND checked_in_at > now() - interval '90 minutes'
  ) INTO v_recent_ok;

  IF v_recent_ok THEN
    RETURN QUERY SELECT 'ALREADY_CHECKED_IN', 'Already checked in.';
    RETURN;
  END IF;

  INSERT INTO member_checkins (gym_id, member_id, local_date, status, source)
  VALUES (p_gym_id, v_member.id, v_local_date, 'ok', 'manual');
  RETURN QUERY SELECT 'OK', 'Checked in manually.';
END;
$$;

COMMENT ON FUNCTION sculpt_manual_checkin(uuid, uuid) IS
  'Staff/owner fallback for when the desk tablet is offline and the QR '
  'has stopped rotating — see HANDOVER.md §6. Writes source=''manual''.';

REVOKE ALL ON FUNCTION sculpt_manual_checkin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_manual_checkin(uuid, uuid) TO authenticated;
