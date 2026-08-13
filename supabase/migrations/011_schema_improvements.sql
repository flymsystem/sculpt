-- Migration 011: Schema improvements
-- Run AFTER 010_budget_receipts.sql

BEGIN;

-- 1. Convert member_addons from TEXT to JSONB for queryability + validation
ALTER TABLE members 
  ALTER COLUMN member_addons TYPE JSONB USING 
    CASE 
      WHEN member_addons IS NULL THEN NULL
      WHEN member_addons = '' THEN NULL
      ELSE member_addons::JSONB
    END;

-- 2. Add referred_by to track which member referred this one
ALTER TABLE members ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_members_referred_by ON members(referred_by) WHERE referred_by IS NOT NULL;

-- 3. Add WhatsApp templates to gyms
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS wa_birthday_template TEXT;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS wa_welcome_template TEXT;

-- 4. Rebuild members_with_status view to include new columns
DROP VIEW IF EXISTS members_with_status;
CREATE VIEW members_with_status
  WITH (security_invoker = true)
AS
SELECT
  m.*,
  g.name AS gym_name,
  ref.full_name AS referred_by_name,
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
LEFT JOIN members ref ON ref.id = m.referred_by
WHERE m.is_active = TRUE;

GRANT SELECT ON members_with_status TO authenticated;

COMMIT;
