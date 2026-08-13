-- Migration 023: Audit fixes
-- Fixes: C-2 (members_with_status regression), C-3 (get_my_gym_id multi-branch),
--         D-3 (gym_users UNIQUE(user_id) blocks multi-branch), D-4 (phone index)
-- Run in Supabase SQL editor. Idempotent.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Fix get_my_gym_id() — must respect is_selected for multi-branch
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_my_gym_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gym_id
  FROM public.gym_users
  WHERE user_id = auth.uid()
    AND role = 'owner'
  ORDER BY is_selected DESC NULLS LAST
  LIMIT 1;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Drop UNIQUE(user_id) on gym_users if it still exists
--    Multi-branch requires multiple rows per user.
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gym_users_user_id_key'
      AND conrelid = 'public.gym_users'::regclass
  ) THEN
    ALTER TABLE gym_users DROP CONSTRAINT gym_users_user_id_key;
  END IF;
END $$;

-- Add a UNIQUE on (user_id, gym_id) instead to prevent duplicate links
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gym_users_user_gym_unique'
      AND conrelid = 'public.gym_users'::regclass
  ) THEN
    ALTER TABLE gym_users ADD CONSTRAINT gym_users_user_gym_unique UNIQUE (user_id, gym_id);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Restore members_with_status view with full computed columns
--    Migration 022 regressed this to a bare SELECT m.*
-- ═══════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS members_with_status;
CREATE VIEW members_with_status WITH (security_invoker = true) AS
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

-- ═══════════════════════════════════════════════════════════════════
-- 4. Phone index for duplicate-check performance
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_members_phone
  ON members(phone)
  WHERE is_active = true AND phone IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 5. Ensure is_selected column exists on gym_users (may already exist)
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gym_users' AND column_name = 'is_selected'
  ) THEN
    ALTER TABLE gym_users ADD COLUMN is_selected boolean DEFAULT false;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 6. Ensure owner_password column exists on gyms
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gyms' AND column_name = 'owner_password'
  ) THEN
    ALTER TABLE gyms ADD COLUMN owner_password text;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 7. Recreate gym_summary view (it references members_with_status
--    columns that were broken — use direct member table instead)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW gym_summary
  WITH (security_invoker = true)
AS
SELECT
  g.id            AS gym_id,
  g.name          AS gym_name,
  g.gym_code,
  g.owner_name,
  g.phone,
  g.city,
  g.address,
  g.email,
  g.is_active,
  g.created_at,
  COUNT(m.id)                                                              AS total_members,
  COUNT(m.id) FILTER (
    WHERE m.member_type != 'Trial'
      AND m.expiry_date >= CURRENT_DATE
      AND m.payment_status != 'Due'
      AND m.cancelled_at IS NULL
  )                                                                        AS active_members,
  COUNT(m.id) FILTER (
    WHERE (m.payment_status = 'Due'
       OR (m.member_type != 'Trial' AND m.expiry_date < CURRENT_DATE))
      AND m.cancelled_at IS NULL
  )                                                                        AS payment_due,
  COUNT(m.id) FILTER (
    WHERE m.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      AND m.cancelled_at IS NULL
  )                                                                        AS expiring_soon
FROM gyms g
LEFT JOIN members m ON m.gym_id = g.id AND m.is_active = TRUE
GROUP BY g.id, g.name, g.gym_code, g.owner_name, g.phone,
         g.city, g.address, g.email, g.is_active, g.created_at;

GRANT SELECT ON gym_summary TO authenticated;
