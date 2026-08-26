-- ═══════════════════════════════════════════════════════════════
-- Migration 126 — members.photo_url column does not exist; every
-- member profile photo upload silently fails to persist
-- ═══════════════════════════════════════════════════════════════
-- A1 (member photo does not persist): upload a member photo, save,
-- navigate away, come back — the photo is gone.
--
-- Traced the whole chain (photo-picker.js -> member-modals.js ->
-- dashboard/photo.js -> storage.objects RLS -> members table -> the
-- members_with_status view getMembers() reads). Storage itself is
-- fine — the 'member-photos' bucket exists (101_sculpt_storage_buckets.sql)
-- and its RLS was already fixed for staff sessions
-- (120_storage_staff_access.sql covers member-photos, not just
-- aadhar-photos — both buckets share the same four policies).
--
-- The break is one step further: dashboard/photo.js's saveMemberPhoto()
-- uploads the blob to storage successfully, then runs
--   supabase.from('members').update({ photo_url: photoUrl })
-- against a column that has never existed on `members`. There is an
-- aadhar_photo_url column (028_aadhar_photo.sql) but no plain
-- photo_url — nothing in any migration ever added it, even though
-- photo.js, member-modals.js and members_with_status's callers have
-- referenced `photo_url` since the feature was written. PostgREST
-- rejects the UPDATE for the unknown column, saveMemberPhoto() surfaces
-- that as the amber "Photo uploaded but failed to save URL" toast (easy
-- to miss / dismiss), and:
--   - the storage object is left orphaned (upload really did succeed),
--   - the member row's photo_url is never set,
--   - members_with_status (members.js getMembers(), migration 104's
--     definition) can't even select a column that isn't there, so
--     there was nothing for the dashboard to render on reload regardless
--     of the toast being noticed.
-- This affects add, edit/replace AND remove flows identically, and
-- both owner and staff sessions — it has nothing to do with the RLS
-- gap 120 fixed; the column was simply never created.
--
-- Fix: add the column, and add it to members_with_status's explicit
-- column list (that view enumerates columns rather than using `m.*`,
-- per its live definition — see 104_member_accounts.sql's
-- CREATE VIEW; the copy below is that same live definition, verified
-- with pg_get_viewdef against the linked project, with photo_url
-- appended and nothing else changed. Per CLAUDE.md's "copying a
-- function/view body forward" rule, this is the CURRENT definition,
-- not a reconstruction from an older migration. photo_url is appended
-- at the END of the SELECT list rather than grouped next to
-- aadhar_photo_url on purpose — CREATE OR REPLACE VIEW refuses to
-- reorder or rename existing output columns (42P16), it can only add
-- new ones after the last existing one; tried the "logically grouped"
-- placement first and Postgres rejected it.
--
-- Safe to run more than once — ADD COLUMN IF NOT EXISTS, and the view
-- is CREATE OR REPLACE with the same options it already has
-- (security_invoker = true, confirmed live via pg_class.reloptions).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS photo_url text;

CREATE OR REPLACE VIEW members_with_status
  WITH (security_invoker = true)
AS
SELECT
  id,
  gym_id,
  full_name,
  phone,
  email,
  date_of_birth,
  gender,
  join_date,
  plan_id,
  plan_name,
  plan_price,
  plan_duration_months,
  expiry_date,
  payment_mode,
  payment_status,
  member_type,
  notes,
  is_active,
  created_at,
  updated_at,
  cardio_addon,
  cardio_price,
  last_reminder_sent,
  member_addons,
  referred_by,
  discount_amount,
  balance_due,
  cancelled_at,
  application_number,
  aadhar_number,
  aadhar_photo_url,
  user_id,
  login_enabled,
  added_by_staff_id,
  added_by_name,
  CASE
    WHEN cancelled_at IS NOT NULL THEN 'Cancelled'::text
    WHEN member_type = 'Trial'::text AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE THEN 'Expired'::text
    WHEN member_type = 'Trial'::text THEN 'Trial'::text
    WHEN expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE THEN 'Expired'::text
    WHEN expiry_date IS NOT NULL AND expiry_date <= (CURRENT_DATE + '7 days'::interval) THEN 'Expiring'::text
    WHEN payment_status = 'Due'::text THEN 'Due'::text
    ELSE 'Active'::text
  END AS computed_status,
  CASE
    WHEN expiry_date IS NOT NULL THEN expiry_date - CURRENT_DATE
    ELSE NULL::integer
  END AS days_until_expiry,
  photo_url
FROM members m
WHERE is_active = true;

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- select column_name from information_schema.columns
--   where table_name = 'members' and column_name = 'photo_url';
-- select photo_url from members_with_status limit 1;
-- Then in the app, as both owner and staff: add a member with a photo,
-- edit an existing member's photo, remove a photo — reload the members
-- list each time and confirm it sticks.
-- ═══════════════════════════════════════════════════════════════
