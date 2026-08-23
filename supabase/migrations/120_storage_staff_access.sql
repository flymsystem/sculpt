-- ═══════════════════════════════════════════════════════════════
-- Migration 120 — storage policies (member/aadhaar/gym-logo/invoice
-- objects) are owner-only; staff gets a policy-denied error on every
-- photo/Aadhaar/invoice storage operation
-- ═══════════════════════════════════════════════════════════════
-- FIX-PROMPT.md item 4 (member photo upload) — found while tracing why
-- photo uploads fail. 101_sculpt_storage_buckets.sql scoped every
-- storage.objects policy on `(storage.foldername(name))[1] =
-- public.get_my_gym_id()::text`. get_my_gym_id() only matches
-- gym_users.role = 'owner' (see its definition) — it returns NULL for
-- a staff session, so every one of these policies silently denies staff
-- regardless of what the UI lets them attempt. The staff-safe
-- equivalent, get_my_gym_id_as_staff(), already exists (used by every
-- other staff RLS policy in this schema — see CLAUDE.md) but was never
-- wired into the storage policies from 101.
--
-- Fix: each policy now accepts either function's result, matching the
-- gym_id path segment. Nothing about the owner path changes.
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "gym_read_own_objects"   ON storage.objects;
DROP POLICY IF EXISTS "gym_insert_own_objects" ON storage.objects;
DROP POLICY IF EXISTS "gym_update_own_objects" ON storage.objects;
DROP POLICY IF EXISTS "gym_delete_own_objects" ON storage.objects;

CREATE POLICY "gym_read_own_objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('member-photos','gym-logos','aadhar-photos','invoices')
    AND (storage.foldername(name))[1] = coalesce(public.get_my_gym_id(), public.get_my_gym_id_as_staff())::text
  );

CREATE POLICY "gym_insert_own_objects" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('member-photos','gym-logos','aadhar-photos','invoices')
    AND (storage.foldername(name))[1] = coalesce(public.get_my_gym_id(), public.get_my_gym_id_as_staff())::text
  );

CREATE POLICY "gym_update_own_objects" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('member-photos','gym-logos','aadhar-photos','invoices')
    AND (storage.foldername(name))[1] = coalesce(public.get_my_gym_id(), public.get_my_gym_id_as_staff())::text
  );

CREATE POLICY "gym_delete_own_objects" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('member-photos','gym-logos','aadhar-photos','invoices')
    AND (storage.foldername(name))[1] = coalesce(public.get_my_gym_id(), public.get_my_gym_id_as_staff())::text
  );

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- Log in as staff, add/edit a member with a photo — upload must
-- succeed. Owner behaviour must be unchanged.
-- ═══════════════════════════════════════════════════════════════
