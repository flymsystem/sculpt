-- ═══════════════════════════════════════════════════════════════
-- Migration 116 — columns to show staff login status at a glance
-- ═══════════════════════════════════════════════════════════════
-- The owner has no way to tell, without leaving the app, who can log
-- in: what email a staff login uses, or when it was created.
-- staff.login_enabled already exists (030) but the login email lives
-- only in auth.users, which the client can never query directly (no
-- service role in the browser). Rather than add a round-trip Edge
-- Function call just to list this on every Staff page render, the
-- login email and creation time are denormalized onto `staff` —
-- written once by create-staff-user / manage-staff-login (service
-- role, same trust boundary that already owns this data) and read by
-- an ordinary authenticated SELECT the rest of the page already does.
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE staff ADD COLUMN IF NOT EXISTS login_email text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS login_created_at timestamptz;

COMMENT ON COLUMN staff.login_email IS
  'Denormalized copy of the auth.users email for this staff member''s '
  'login, for display only. Written by create-staff-user / '
  'manage-staff-login (service role). Cleared when the login is removed.';
COMMENT ON COLUMN staff.login_created_at IS
  'When the login account was created. Set once by create-staff-user, '
  'never touched by disable/enable/reset-password. Cleared when the '
  'login is removed (a re-created login gets a fresh timestamp).';
