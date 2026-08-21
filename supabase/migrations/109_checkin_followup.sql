-- ─────────────────────────────────────────────────────────────────
-- 109_checkin_followup.sql
--
-- Phase 3 — the "not seen recently" follow-up list and live realtime
-- updates for the attendance log.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS checkin_followup_days int NOT NULL DEFAULT 21;
COMMENT ON COLUMN gyms.checkin_followup_days IS
  'Days since last check-in (or since join_date, for a member who has '
  'never checked in) before they appear on the follow-up call list.';

-- Editable in Gym Settings — see DEFAULT_FOLLOWUP_WA_TEMPLATE in
-- src/pages/dashboard/state.js.
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS followup_wa_template text;

-- Not SECURITY DEFINER on purpose: it queries members and member_checkins
-- directly under the caller's own RLS, so an owner or staff account only
-- ever gets rows for their own gym even if p_gym_id is spoofed — the
-- underlying table policies (owner_all_own_members, staff_read_members,
-- owner_read_gym_checkins, staff_read_gym_checkins) do the enforcement,
-- the same way any other plain query from the dashboard already does.
CREATE OR REPLACE FUNCTION sculpt_checkin_followup(p_gym_id uuid, p_threshold_days int DEFAULT NULL)
RETURNS TABLE (
  member_id             uuid,
  full_name             text,
  phone                 text,
  join_date             date,
  last_visit            timestamptz,
  days_since_last_visit int
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH threshold AS (
    SELECT COALESCE(p_threshold_days, (SELECT checkin_followup_days FROM gyms WHERE id = p_gym_id), 21) AS days
  ),
  last_ok AS (
    SELECT c.member_id, MAX(c.checked_in_at) AS last_visit
    FROM member_checkins c
    WHERE c.gym_id = p_gym_id AND c.status = 'ok'
    GROUP BY c.member_id
  )
  SELECT
    m.id, m.full_name, m.phone, m.join_date, lo.last_visit,
    CASE
      WHEN lo.last_visit IS NOT NULL THEN EXTRACT(DAY FROM now() - lo.last_visit)::int
      ELSE EXTRACT(DAY FROM now() - m.join_date::timestamptz)::int
    END AS days_since_last_visit
  FROM members m
  LEFT JOIN last_ok lo ON lo.member_id = m.id
  CROSS JOIN threshold t
  WHERE m.gym_id = p_gym_id
    AND m.is_active = true
    AND m.cancelled_at IS NULL
    AND (m.expiry_date IS NULL OR m.expiry_date >= CURRENT_DATE)
    AND (
      (lo.last_visit IS NOT NULL AND lo.last_visit < now() - (t.days || ' days')::interval)
      -- Never checked in: only surfaced once they've HAD threshold days
      -- to do so, measured from join_date — a member who joined
      -- yesterday must not appear on a 21-day follow-up list.
      OR (lo.last_visit IS NULL AND m.join_date <= CURRENT_DATE - t.days)
    )
  ORDER BY days_since_last_visit DESC;
$$;

COMMENT ON FUNCTION sculpt_checkin_followup(uuid, int) IS
  'Active, non-expired, non-cancelled members who have not checked in '
  'within the threshold — the owner''s renewal call list, distinct from '
  'the denied_expired rows member_checkins already records for people who '
  'tried to enter and were blocked.';

REVOKE ALL ON FUNCTION sculpt_checkin_followup(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_checkin_followup(uuid, int) TO authenticated;

-- ── Realtime ────────────────────────────────────────────────────
-- Lets the attendance log update live without polling, same pattern
-- as the notification bell in migration 031.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.member_checkins;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
