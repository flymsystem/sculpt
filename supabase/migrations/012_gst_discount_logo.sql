-- Migration 012: GST toggle, gym logo, member discount + balance tracking
-- Run AFTER 011_schema_improvements.sql
-- Safe to re-run — policies are dropped before recreation.

BEGIN;

-- 1. Drop view FIRST (m.* expansion shifts column positions when members gets new columns)
DROP VIEW IF EXISTS members_with_status;

-- 2. Gym-level: GST toggle, GSTIN, logo
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS gst_enabled BOOLEAN DEFAULT false;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS gstin TEXT;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 3. Member-level: discount + outstanding balance
ALTER TABLE members ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS balance_due NUMERIC DEFAULT 0;

-- 4. Rebuild view (m.* auto-picks up the new member columns)
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

-- 5. Storage bucket for gym logos (mirrors member-photos pattern)
INSERT INTO storage.buckets (id, name, public)
VALUES ('gym-logos', 'gym-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Postgres has no "CREATE POLICY IF NOT EXISTS" — drop first so this is safe to re-run
DROP POLICY IF EXISTS "gym_logos_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "gym_logos_owner_write"  ON storage.objects;
DROP POLICY IF EXISTS "gym_logos_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "gym_logos_admin_all"    ON storage.objects;

CREATE POLICY "gym_logos_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'gym-logos');

CREATE POLICY "gym_logos_owner_write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'gym-logos' AND (storage.foldername(name))[1] = get_my_gym_id()::text);

CREATE POLICY "gym_logos_owner_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'gym-logos' AND (storage.foldername(name))[1] = get_my_gym_id()::text);

CREATE POLICY "gym_logos_admin_all" ON storage.objects
  FOR ALL USING (bucket_id = 'gym-logos' AND is_flym_admin());

COMMIT;
