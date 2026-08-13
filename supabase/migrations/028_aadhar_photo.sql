-- Migration 028: Aadhaar card photo storage
-- Adds aadhar_photo_url column to members, creates aadhar-photos storage bucket
-- with gym-scoped RLS policies.
-- Run AFTER 027_aadhar_number.sql
-- Next migration: 029

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. Add aadhar_photo_url column (optional, text)
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'members' AND column_name = 'aadhar_photo_url'
  ) THEN
    ALTER TABLE members ADD COLUMN aadhar_photo_url text;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. Rebuild members_with_status view (m.* needs DROP + CREATE)
-- ═══════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS members_with_status;
CREATE VIEW members_with_status
  WITH (security_invoker = true)
AS
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

-- ═══════════════════════════════════════════════════════════════
-- 3. Create aadhar-photos storage bucket (public read)
--    Bucket creation is done via Supabase Dashboard or API —
--    the SQL below sets up the RLS policies. Create the bucket
--    manually in Supabase → Storage → New Bucket:
--      Name: aadhar-photos
--      Public: ON (so photo URLs work without auth tokens)
-- ═══════════════════════════════════════════════════════════════

-- Public read: anyone can view (photos served via public URL)
DROP POLICY IF EXISTS "Anyone can view aadhar photos" ON storage.objects;
CREATE POLICY "Anyone can view aadhar photos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'aadhar-photos'
  );

-- Gym owners can upload (scoped to their gym folder)
DROP POLICY IF EXISTS "Gym owners can upload aadhar photos" ON storage.objects;
CREATE POLICY "Gym owners can upload aadhar photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'aadhar-photos'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  );

-- Gym owners can update (upsert)
DROP POLICY IF EXISTS "Gym owners can update aadhar photos" ON storage.objects;
CREATE POLICY "Gym owners can update aadhar photos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'aadhar-photos'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  )
  WITH CHECK (
    bucket_id = 'aadhar-photos'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  );

-- Gym owners can delete
DROP POLICY IF EXISTS "Gym owners can delete aadhar photos" ON storage.objects;
CREATE POLICY "Gym owners can delete aadhar photos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'aadhar-photos'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  );

-- Admin can manage all
DROP POLICY IF EXISTS "Admins can manage all aadhar photos" ON storage.objects;
CREATE POLICY "Admins can manage all aadhar photos" ON storage.objects
  FOR ALL USING (
    bucket_id = 'aadhar-photos' AND (SELECT is_flym_admin())
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- MANUAL STEP REQUIRED:
-- Create the "aadhar-photos" bucket in Supabase Dashboard:
--   Supabase → Storage → New Bucket
--   Name: aadhar-photos
--   Public: ON
-- Then run this migration in the SQL Editor.
-- ═══════════════════════════════════════════════════════════════
