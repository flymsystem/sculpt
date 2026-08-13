-- Migration 029: Invoice PDF storage
-- Creates gym-scoped RLS policies for an 'invoices' bucket, used to
-- host generated invoice PDFs so a link can be sent via WhatsApp
-- (see openInvoiceModal / generateInvoicePdfBlob / uploadInvoicePdf).
-- Run AFTER 028--aadhar_photo.sql
--
-- ═══════════════════════════════════════════════════════════════
-- MANUAL STEP REQUIRED FIRST:
--   Supabase Dashboard → Storage → New Bucket
--     Name: invoices
--     Public: ON   (so wa.me links work without an auth token)
--   Then run this migration in the SQL Editor.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- Public read: anyone with the link can view/download (served via public URL)
DROP POLICY IF EXISTS "Anyone can view invoices" ON storage.objects;
CREATE POLICY "Anyone can view invoices" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'invoices'
  );

-- Gym owners can upload (scoped to their gym folder — {gymId}/{memberId}/{invoiceNo}.pdf)
DROP POLICY IF EXISTS "Gym owners can upload invoices" ON storage.objects;
CREATE POLICY "Gym owners can upload invoices" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'invoices'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  );

-- Gym owners can update (upsert re-sends of the same invoice number)
DROP POLICY IF EXISTS "Gym owners can update invoices" ON storage.objects;
CREATE POLICY "Gym owners can update invoices" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'invoices'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  )
  WITH CHECK (
    bucket_id = 'invoices'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  );

-- Gym owners can delete
DROP POLICY IF EXISTS "Gym owners can delete invoices" ON storage.objects;
CREATE POLICY "Gym owners can delete invoices" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'invoices'
    AND (storage.foldername(name))[1] = (SELECT get_my_gym_id())::text
  );

-- Admin can manage all
DROP POLICY IF EXISTS "Admins can manage all invoices" ON storage.objects;
CREATE POLICY "Admins can manage all invoices" ON storage.objects
  FOR ALL USING (
    bucket_id = 'invoices' AND (SELECT is_flym_admin())
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- Next migration: 030
-- ═══════════════════════════════════════════════════════════════
