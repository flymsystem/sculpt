-- Migration 027: Add Aadhar ID to members
-- Run AFTER 026_wa_webhook.sql

BEGIN;

-- 1. Add aadhar_number column (optional, text)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'members' AND column_name = 'aadhar_number'
  ) THEN
    ALTER TABLE members ADD COLUMN aadhar_number text;
  END IF;
END $$;

-- 2. Rebuild members_with_status view to include the new column
--    (m.* already captures it, but views cache column lists — must DROP + CREATE)
DROP VIEW IF EXISTS members_with_status;
CREATE VIEW members_with_status
  WITH (security_invoker = true)
AS
SELECT m.* FROM members m WHERE m.is_active = true;

GRANT SELECT ON members_with_status TO authenticated;

COMMIT;
