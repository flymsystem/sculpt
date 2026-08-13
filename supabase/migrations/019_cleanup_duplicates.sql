-- Migration 019: cleanup_duplicates
-- 1. Drop orphan gyms.gst_number column (superseded by gstin, migration 012; unused in app code)
-- 2. Consolidate duplicate storage policies on member-photos bucket (legacy SQL-editor set
--    vs. dashboard-generated set) and capture the canonical policies in version control
--    for the first time — they previously existed live but were never saved to a migration.
-- Idempotent: safe to re-run.

-- ============================================================
-- 1. Drop orphan column
-- ============================================================
ALTER TABLE gyms DROP COLUMN IF EXISTS gst_number;

-- ============================================================
-- 2. Remove legacy/duplicate member-photos storage policies
-- ============================================================
DROP POLICY IF EXISTS "owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "owner_upload" ON storage.objects;
DROP POLICY IF EXISTS "public_read" ON storage.objects;

-- ============================================================
-- 3. Re-assert canonical member-photos policies (now version-controlled)
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage all member photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view member photos" ON storage.objects;
DROP POLICY IF EXISTS "Gym owners can delete member photos" ON storage.objects;
DROP POLICY IF EXISTS "Gym owners can update member photos" ON storage.objects;
DROP POLICY IF EXISTS "Gym owners can upload member photos" ON storage.objects;

CREATE POLICY "Admins can manage all member photos" ON storage.objects
  FOR ALL USING (
    bucket_id = 'member-photos' AND (SELECT is_flym_admin())
  );

CREATE POLICY "Anyone can view member photos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'member-photos'
  );

CREATE POLICY "Gym owners can upload member photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'member-photos'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  );

CREATE POLICY "Gym owners can update member photos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'member-photos'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  );

CREATE POLICY "Gym owners can delete member photos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'member-photos'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  );
