-- ─────────────────────────────────────────────────────────────────
-- 110_invoices_private.sql
--
-- Phase 4 — receipts hardening (CHECKIN-PLAN.md §5). The `invoices`
-- bucket has been public since migration 101, and src/lib/invoices.js
-- hands out getPublicUrl() links — any member's receipt is readable
-- by anyone who has or guesses the URL. Tolerable while nobody was
-- looking; not tolerable now that a member portal exists that lists
-- receipts. Cheapest to fix while there's still little data in it.
--
-- After this runs, src/lib/invoices.js must switch to
-- createSignedUrl() (done in the same commit as this migration) — a
-- getPublicUrl() link against a private bucket 404s.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

UPDATE storage.buckets SET public = false WHERE id = 'invoices';

-- gym_read_own_objects (migration 101) already lets owner/staff SELECT
-- from this bucket, scoped by the gym-id path segment — that policy is
-- untouched. This adds the member's own narrow slice, scoped by the
-- member-id path segment (path is {gymId}/{memberId}/{invoiceNo}.pdf).
DROP POLICY IF EXISTS "member_read_own_invoices" ON storage.objects;
CREATE POLICY "member_read_own_invoices" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (storage.foldername(name))[2] = get_my_member_id()::text
  );
