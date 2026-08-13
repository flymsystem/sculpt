-- Migration 015: Cancel Membership feature
-- Member stays visible in the Members table with a "Cancelled" badge —
-- this is NOT a delete/soft-delete, just a membership lifecycle flag.
-- Run AFTER 014_member_phone_optional.sql

BEGIN;

DROP VIEW IF EXISTS members_with_status;

ALTER TABLE members ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Rebuild view (m.* auto-picks up cancelled_at)
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
