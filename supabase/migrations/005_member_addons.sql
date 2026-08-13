-- ─────────────────────────────────────────────────────────────────
-- Migration 005: Per-member Add-ons + View Consolidation
-- Replaces the plan-level addon approach from migration 002.
-- ─────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Add member_addons column (JSON array of {name, price} objects)
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS member_addons TEXT DEFAULT NULL;

COMMENT ON COLUMN members.member_addons IS
  'JSON array of add-ons chosen by this member, e.g. [{"name":"Cardio","price":500}]';

-- 2. Migrate any legacy cardio_addon rows into member_addons
--    so existing data is not lost
UPDATE members
SET member_addons = (
  '[{"name":"Cardio","price":' ||
  COALESCE(cardio_price::TEXT, '500') ||
  '}]'
)
WHERE cardio_addon = TRUE
  AND member_addons IS NULL;

-- 3. Rebuild members_with_status view cleanly:
--    - Restores gym_name JOIN (lost in migration 002)
--    - Consistent column name: days_until_expiry (matches 001)
--    - total_amount now uses member_addons JSON, not cardio_addon
--    - SECURITY INVOKER so caller's RLS applies to the gyms join
DROP VIEW IF EXISTS members_with_status;

CREATE OR REPLACE VIEW members_with_status
  WITH (security_invoker = true)
AS
SELECT
  m.*,
  g.name AS gym_name,
  CASE
    WHEN m.member_type = 'Trial' AND m.expiry_date IS NOT NULL AND m.expiry_date < CURRENT_DATE THEN 'Expired'
    WHEN m.member_type = 'Trial'                                        THEN 'Trial'
    WHEN m.expiry_date IS NOT NULL AND m.expiry_date < CURRENT_DATE     THEN 'Expired'
    WHEN m.expiry_date IS NOT NULL
     AND m.expiry_date <= CURRENT_DATE + INTERVAL '7 days'              THEN 'Expiring'
    WHEN m.payment_status = 'Due'                                       THEN 'Due'
    ELSE                                                                     'Active'
  END AS computed_status,
  CASE
    WHEN m.expiry_date IS NOT NULL THEN (m.expiry_date - CURRENT_DATE)
    ELSE NULL
  END AS days_until_expiry
FROM members m
JOIN gyms g ON g.id = m.gym_id
WHERE m.is_active = TRUE;

-- Re-grant after drop+recreate
GRANT SELECT ON members_with_status TO authenticated;

-- 4. Index for member_addons lookups (partial — only rows with addons)
CREATE INDEX IF NOT EXISTS idx_members_addons
  ON members(gym_id)
  WHERE member_addons IS NOT NULL;

COMMIT;
