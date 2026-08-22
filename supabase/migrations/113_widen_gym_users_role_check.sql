-- ═══════════════════════════════════════════════════════════════
-- Migration 113 — widen gym_users_role_check to allow 'staff'
-- ═══════════════════════════════════════════════════════════════
-- 001_initial_schema.sql defined:
--   role TEXT NOT NULL CHECK (role IN ('owner', 'admin'))
--
-- 030_staff_login_tiers.sql then built the entire staff-login feature
-- around role = 'staff' — get_my_gym_id_as_staff() queries for it,
-- supabase/functions/create-staff-user/index.ts inserts it — but never
-- widened this constraint. The result: every attempt to create a staff
-- login has failed at the gym_users insert with
--   new row for relation "gym_users" violates check constraint
--   "gym_users_role_check"
-- Staff login has never worked in this project. Nothing caught it
-- because, until now, no staff login had ever actually been created.
--
-- 'owner' and 'admin' are kept — 'admin' is the dead value read by the
-- removed superadmin panel's is_flym_admin() (001_initial_schema.sql)
-- and nothing writes it any more, but this migration only widens the
-- constraint, it doesn't prune values. See HANDOVER.md: "a feature
-- that adds a new role value must also widen the constraint that
-- gates it."
--
-- Applied by hand in the Supabase SQL editor on 2026-08-22 (before this
-- file existed). Recorded here, idempotently, so the migration history
-- matches what production actually has.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE gym_users DROP CONSTRAINT IF EXISTS gym_users_role_check;
ALTER TABLE gym_users ADD CONSTRAINT gym_users_role_check
  CHECK (role IN ('owner', 'admin', 'staff'));

-- ═══════════════════════════════════════════════════════════════
-- END OF MIGRATION 113
-- Next migration number: 114
-- ═══════════════════════════════════════════════════════════════
