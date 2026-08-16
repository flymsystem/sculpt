-- 101_sculpt_storage_buckets.sql
--
-- Storage buckets. In the original project these were created by hand in
-- the dashboard and therefore existed in no migration — one of the
-- reasons that repository could not rebuild its own database. Scripted
-- here so this one can.
--
-- Four buckets, not three: `invoices` is easy to miss because
-- src/lib/invoices.js reaches it through supabase.storage.from('invoices'),
-- which greps identically to a table query.
--
-- Path convention (see src/pages/dashboard/photo.js):
--   member-photos/{gymId}/{memberId}.jpg
--   aadhar-photos/{gymId}/{memberId}.jpg
--   gym-logos/{gymId}/...
--   invoices/{gymId}/...

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('member-photos', 'member-photos', true),
  ('gym-logos',     'gym-logos',     true),
  ('invoices',      'invoices',      true),
  -- NOT public: government ID scans. Served through signed URLs only.
  ('aadhar-photos', 'aadhar-photos', false)
ON CONFLICT (id) DO NOTHING;

-- ── Policies ─────────────────────────────────────────────────────
-- Scoped by the first path segment, which is always the gym id.
-- storage.foldername(name) returns the path split into an array, so
-- element 1 is that gym id.

DROP POLICY IF EXISTS "gym_read_own_objects"   ON storage.objects;
DROP POLICY IF EXISTS "gym_insert_own_objects" ON storage.objects;
DROP POLICY IF EXISTS "gym_update_own_objects" ON storage.objects;
DROP POLICY IF EXISTS "gym_delete_own_objects" ON storage.objects;

CREATE POLICY "gym_read_own_objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('member-photos','gym-logos','aadhar-photos','invoices')
    AND (storage.foldername(name))[1] = public.get_my_gym_id()::text
  );

CREATE POLICY "gym_insert_own_objects" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('member-photos','gym-logos','aadhar-photos','invoices')
    AND (storage.foldername(name))[1] = public.get_my_gym_id()::text
  );

CREATE POLICY "gym_update_own_objects" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('member-photos','gym-logos','aadhar-photos','invoices')
    AND (storage.foldername(name))[1] = public.get_my_gym_id()::text
  );

-- Removing a photo must delete the object AND null the column; this is
-- the object half.
CREATE POLICY "gym_delete_own_objects" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('member-photos','gym-logos','aadhar-photos','invoices')
    AND (storage.foldername(name))[1] = public.get_my_gym_id()::text
  );

COMMIT;
