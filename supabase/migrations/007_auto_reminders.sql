-- ─────────────────────────────────────────────────────────────────
-- Migration 007: Automatic WhatsApp Reminders (server-side)
--
-- Adds:
--   1. gyms.auto_reminders_enabled  — per-gym opt-in flag (default FALSE)
--   2. members.last_reminder_7d_at  — tracks 7-day reminder per cycle
--   3. members.last_reminder_1d_at  — tracks 1-day reminder per cycle
--   4. reminder_failures             — table for Meta API failures
--   5. get_due_reminders()           — RPC used by the Cloudflare Worker
--   6. record_reminder_sent()        — RPC used after successful send
--
-- Design notes:
--   - Separate 7d and 1d trackers so the same member legitimately
--     receives BOTH the 7-day and 1-day reminders in one cycle.
--   - last_reminder_sent (from migration 004) is retained for the
--     existing manual reminder flow.
--   - RPCs are SECURITY DEFINER so the Worker (using service_role
--     anyway) gets a clean, RLS-free interface.
-- ─────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Per-gym opt-in flag
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS auto_reminders_enabled BOOLEAN DEFAULT FALSE;

-- 2. Per-window reminder trackers on members
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS last_reminder_7d_at DATE,
  ADD COLUMN IF NOT EXISTS last_reminder_1d_at DATE;

-- 3. Failure log — Meta API errors, network issues, opted-out, etc.
CREATE TABLE IF NOT EXISTS reminder_failures (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id      UUID REFERENCES gyms(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES members(id) ON DELETE CASCADE,
  window_days INT,                -- 7 or 1
  error_code  TEXT,
  error_msg   TEXT,
  raw_response JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminder_failures_gym
  ON reminder_failures(gym_id, created_at DESC);

ALTER TABLE reminder_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_reminder_failures" ON reminder_failures;
DROP POLICY IF EXISTS "owner_read_own_failures"     ON reminder_failures;

CREATE POLICY "admin_all_reminder_failures"
  ON reminder_failures FOR ALL USING (is_flym_admin());

CREATE POLICY "owner_read_own_failures"
  ON reminder_failures FOR SELECT USING (gym_id = get_my_gym_id());

-- ─────────────────────────────────────────────────────────────────
-- 4. get_due_reminders() — returns the queue of members to message
--
-- Returns rows where:
--   - Gym has auto_reminders_enabled = TRUE  AND is_active = TRUE
--   - Member is active, not Trial, has a valid expiry_date
--   - Member has phone + plan_name
--   - Expiry is exactly 7 days OR 1 day from CURRENT_DATE (IST)
--   - The relevant tracker (7d or 1d) is NULL or older than today
--
-- window_days column tells the Worker which template variable set
-- to use and which tracker to update after successful send.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_due_reminders()
RETURNS TABLE (
  gym_id          UUID,
  gym_name        TEXT,
  member_id       UUID,
  member_name     TEXT,
  phone           TEXT,
  plan_name       TEXT,
  expiry_date     DATE,
  window_days     INT,
  wa_template     TEXT
)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH today AS (
    -- IST = UTC + 5:30
    SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE AS d
  )
  -- 7-day reminders
  SELECT
    g.id,
    g.name,
    m.id,
    m.full_name,
    m.phone,
    COALESCE(m.plan_name, 'membership'),
    m.expiry_date,
    7,
    g.wa_template
  FROM members m
  JOIN gyms g ON g.id = m.gym_id, today
  WHERE g.auto_reminders_enabled = TRUE
    AND g.is_active = TRUE
    AND m.is_active = TRUE
    AND m.member_type != 'Trial'
    AND m.phone IS NOT NULL AND m.phone <> ''
    AND m.expiry_date IS NOT NULL
    AND m.expiry_date - today.d = 7
    AND (m.last_reminder_7d_at IS NULL OR m.last_reminder_7d_at < today.d)
  UNION ALL
  -- 1-day reminders
  SELECT
    g.id,
    g.name,
    m.id,
    m.full_name,
    m.phone,
    COALESCE(m.plan_name, 'membership'),
    m.expiry_date,
    1,
    g.wa_template
  FROM members m
  JOIN gyms g ON g.id = m.gym_id, today
  WHERE g.auto_reminders_enabled = TRUE
    AND g.is_active = TRUE
    AND m.is_active = TRUE
    AND m.member_type != 'Trial'
    AND m.phone IS NOT NULL AND m.phone <> ''
    AND m.expiry_date IS NOT NULL
    AND m.expiry_date - today.d = 1
    AND (m.last_reminder_1d_at IS NULL OR m.last_reminder_1d_at < today.d);
$$;

-- ─────────────────────────────────────────────────────────────────
-- 5. record_reminder_sent() — atomic update + log after Meta API success
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_reminder_sent(
  p_member_id   UUID,
  p_gym_id      UUID,
  p_window_days INT,
  p_message     TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_ist DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
BEGIN
  -- Update the right tracker column
  IF p_window_days = 7 THEN
    UPDATE members
       SET last_reminder_7d_at = today_ist,
           last_reminder_sent  = today_ist
     WHERE id = p_member_id AND gym_id = p_gym_id;
  ELSIF p_window_days = 1 THEN
    UPDATE members
       SET last_reminder_1d_at = today_ist,
           last_reminder_sent  = today_ist
     WHERE id = p_member_id AND gym_id = p_gym_id;
  END IF;

  -- Existing reminder log table
  INSERT INTO reminder_logs (gym_id, member_id, message, channel)
  VALUES (p_gym_id, p_member_id, p_message, 'whatsapp_auto');

  -- Existing activity log
  INSERT INTO activity_log (gym_id, action, description)
  VALUES (p_gym_id, 'auto_reminder_sent',
          'Auto WhatsApp reminder sent (' || p_window_days || '-day window)');
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 6. record_reminder_failure() — log API failures for debugging
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_reminder_failure(
  p_member_id   UUID,
  p_gym_id      UUID,
  p_window_days INT,
  p_error_code  TEXT,
  p_error_msg   TEXT,
  p_raw         JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO reminder_failures
    (gym_id, member_id, window_days, error_code, error_msg, raw_response)
  VALUES (p_gym_id, p_member_id, p_window_days, p_error_code, p_error_msg, p_raw);
END;
$$;

-- Grants — the Worker uses service_role which bypasses these anyway,
-- but explicit grants are cleaner.
GRANT EXECUTE ON FUNCTION get_due_reminders()        TO service_role;
GRANT EXECUTE ON FUNCTION record_reminder_sent       TO service_role;
GRANT EXECUTE ON FUNCTION record_reminder_failure    TO service_role;

COMMIT;
