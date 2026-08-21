-- ─────────────────────────────────────────────────────────────────
-- 111_fix_returns_table_column_shadowing.sql
--
-- ROOT CAUSE (confirmed via the Management API against production,
-- not inferred): sculpt_issue_checkin_token() returned HTTP 400,
-- Postgres error 42702 — "column reference \"expires_at\" is
-- ambiguous... It could refer to either a PL/pgSQL variable or a
-- table column."
--
-- RETURNS TABLE (...) output names are NOT just documentation — in a
-- LANGUAGE plpgsql function they are implicitly declared as ordinary
-- PL/pgSQL variables, in scope for the whole function body. Every
-- function this feature added that both (a) is LANGUAGE plpgsql and
-- (b) touches a table sharing a column name with one of its own
-- RETURNS TABLE outputs has this trap. Three did:
--
--   sculpt_issue_checkin_token()  — RETURNS TABLE (token, expires_at)
--                                    DELETE ... WHERE expires_at < ...
--                                    (checkin_tokens.expires_at)
--   sculpt_member_checkin(text)   — RETURNS TABLE (status, message)
--                                    WHERE ... status = 'ok'
--                                    (member_checkins.status)
--   sculpt_manual_checkin(uuid,uuid) — same RETURNS TABLE shape,
--                                    same member_checkins.status hit
--
-- sculpt_staff_checkin(text) was checked too — it also RETURNS TABLE
-- (status, message) and writes staff_attendance.status, but only ever
-- inside an INSERT column-list (not an ambiguity site: column-list
-- targets aren't resolved as expressions) — it never reads status back
-- as a bare identifier, so it was not actually broken. Confirmed by
-- reading the function body, not assumed.
--
-- The LANGUAGE sql functions in 108/109 (sculpt_my_membership,
-- sculpt_my_visits, sculpt_my_receipts, sculpt_checkin_followup) were
-- checked too and are not affected — plain SQL functions have no
-- PL/pgSQL variable layer, so there is nothing for a RETURNS TABLE
-- name to shadow.
--
-- FIX: qualify every table-column reference inside the three affected
-- bodies with a table alias, rather than renaming the OUT parameters —
-- renaming would change the JSON keys PostgREST returns, which is a
-- public API break for src/lib/checkin.js's callers. Same signatures,
-- same CREATE OR REPLACE (105 and 107 stay untouched — they're
-- already applied).
--
-- See CLAUDE.md's "Conventions" section for the rule this is now
-- written down as, so it isn't rediscovered the same way twice.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sculpt_issue_checkin_token()
RETURNS TABLE (token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gym_id uuid;
  v_token text;
  v_expires timestamptz;
BEGIN
  v_gym_id := COALESCE(get_my_gym_id_as_staff(), (
    SELECT gym_id FROM gym_users WHERE user_id = auth.uid() AND role = 'owner' LIMIT 1
  ));

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Was: WHERE gym_id = v_gym_id AND expires_at < now() - interval '5
  -- minutes' — bare expires_at resolved to the RETURNS TABLE variable,
  -- not checkin_tokens.expires_at, and Postgres refused to guess.
  DELETE FROM checkin_tokens ct
  WHERE ct.gym_id = v_gym_id AND ct.expires_at < now() - interval '5 minutes';

  v_token := encode(gen_random_bytes(16), 'hex');
  v_expires := now() + interval '90 seconds';

  INSERT INTO checkin_tokens (gym_id, token, expires_at, created_by)
  VALUES (v_gym_id, v_token, v_expires, auth.uid());

  RETURN QUERY SELECT v_token, v_expires;
END;
$$;

REVOKE ALL ON FUNCTION sculpt_issue_checkin_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_issue_checkin_token() TO authenticated;

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

  -- Was: WHERE member_id = v_member.id AND status = 'ok' — bare status
  -- resolved to this function's own RETURNS TABLE variable, not
  -- member_checkins.status.
  SELECT EXISTS (
    SELECT 1 FROM member_checkins mc
    WHERE mc.member_id = v_member.id AND mc.status = 'ok'
      AND mc.checked_in_at > now() - interval '90 minutes'
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

REVOKE ALL ON FUNCTION sculpt_member_checkin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_member_checkin(text) TO authenticated;

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

  -- Same shadowing bug as sculpt_member_checkin above, same fix.
  SELECT EXISTS (
    SELECT 1 FROM member_checkins mc
    WHERE mc.member_id = v_member.id AND mc.status = 'ok'
      AND mc.checked_in_at > now() - interval '90 minutes'
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

REVOKE ALL ON FUNCTION sculpt_manual_checkin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_manual_checkin(uuid, uuid) TO authenticated;
