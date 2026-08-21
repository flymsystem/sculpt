-- ─────────────────────────────────────────────────────────────────
-- 105_checkin_tokens.sql
--
-- The desk QR is not static: the display asks for a fresh token every
-- 30s and re-renders. Each token is valid 90s so the current and
-- previous codes overlap and a slow scan never fails. A photograph of
-- the screen is dead within 90 seconds — that's the whole
-- anti-spoofing mechanism (CHECKIN-PLAN.md §2).
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS checkin_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id     uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_checkin_tokens_token ON checkin_tokens (token);
CREATE INDEX IF NOT EXISTS idx_checkin_tokens_gym_expiry ON checkin_tokens (gym_id, expires_at DESC);

ALTER TABLE checkin_tokens ENABLE ROW LEVEL SECURITY;

-- No direct table access from the client at all — issuing and
-- validating tokens both go through SECURITY DEFINER functions. A
-- narrow owner/staff SELECT policy would still let a compromised
-- staff session enumerate every token including ones from the last
-- 90 seconds, which is the exact thing the rotation defends against.
DROP POLICY IF EXISTS "no_direct_access_checkin_tokens" ON checkin_tokens;
CREATE POLICY "no_direct_access_checkin_tokens" ON checkin_tokens
  FOR ALL USING (false);

-- ── Issue a fresh token ─────────────────────────────────────────
-- Owner or staff only (the desk tablet is signed in as a staff
-- account per CHECKIN-PLAN.md §1). Deletes this gym's tokens older
-- than 5 minutes on the way through, so the table self-cleans and
-- never needs a cron job.
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

  DELETE FROM checkin_tokens
  WHERE gym_id = v_gym_id AND expires_at < now() - interval '5 minutes';

  v_token := encode(gen_random_bytes(16), 'hex');
  v_expires := now() + interval '90 seconds';

  INSERT INTO checkin_tokens (gym_id, token, expires_at, created_by)
  VALUES (v_gym_id, v_token, v_expires, auth.uid());

  RETURN QUERY SELECT v_token, v_expires;
END;
$$;

COMMENT ON FUNCTION sculpt_issue_checkin_token() IS
  'Owner/staff only. Issues a 90s-lived rotating check-in token for the '
  'caller''s gym. Raising here (auth failure) is fine — nothing has been '
  'written yet, unlike sculpt_staff_checkin which must never raise.';

REVOKE ALL ON FUNCTION sculpt_issue_checkin_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_issue_checkin_token() TO authenticated;
