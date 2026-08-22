-- ═══════════════════════════════════════════════════════════════
-- Migration 115 — deactivating/removing staff must revoke their login
-- ═══════════════════════════════════════════════════════════════
-- SECURITY HOLE: get_my_gym_id_as_staff() (030_staff_login_tiers.sql)
-- only checked that a gym_users row existed with role = 'staff'. It
-- never checked staff.is_active or staff.login_enabled. Every RLS
-- policy and RPC gated on "is this caller a staff member of this gym"
-- goes through this one function, so a staff member who had been
-- removed via the existing Remove-Staff action (deleteStaff() in
-- src/lib/staff.js, which sets staff.is_active = false — this app's
-- normal soft-delete pattern, see CLAUDE.md) could still sign in and
-- read every member's name, phone number, Aadhaar photo and payment
-- history for the gym. Their auth session and gym_users row were
-- never touched by that action, and this function never looked at
-- staff.is_active to notice.
--
-- FIX (one change, two consequences):
-- get_my_gym_id_as_staff() now also requires a matching, active staff
-- row with login_enabled = true. Because this is the single choke
-- point every staff RLS policy and staff RPC (sculpt_issue_checkin_
-- token, sculpt_manual_checkin, sculpt_generate_application_number,
-- every staff_* policy from 030) already goes through, this makes
-- BOTH of the following revoke access immediately, with no separate
-- step to remember:
--   1. Deactivating/removing a staff member (is_active -> false) —
--      the existing action, unchanged.
--   2. Disabling a staff login without deactivating the person
--      (login_enabled -> false) — the new "Disable login" action
--      shipping alongside this migration, for suspensions/leave,
--      reversible by setting login_enabled back to true.
-- Their auth.users row and gym_users row are untouched by either —
-- the block happens entirely at the permission-check layer, which is
-- what makes it atomic with the action that caused it rather than a
-- second step someone could forget. "Remove login entirely" (a
-- different, owner-only action landing in the same commit) is the
-- one path that also deletes the auth user and gym_users row, for
-- someone who has left for good.
--
-- gym_users.user_id has no FK to staff, so the join is on
-- (user_id, gym_id) — matching how create-staff-user links the two
-- (staff.user_id set to the same auth user id, staff.gym_id equal to
-- the owner's gym_id at creation time).
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_my_gym_id_as_staff()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gu.gym_id
  FROM public.gym_users gu
  JOIN public.staff s
    ON s.user_id = gu.user_id
   AND s.gym_id  = gu.gym_id
  WHERE gu.user_id = auth.uid()
    AND gu.role = 'staff'
    AND s.is_active = true
    AND s.login_enabled = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_my_gym_id_as_staff() IS
  'Resolves the caller''s gym as a staff member, or NULL if they are '
  'not staff, or their staff row is inactive, or their login has been '
  'disabled. Every staff RLS policy and staff-scoped RPC in this schema '
  'is gated through this one function on purpose, so fixing the check '
  'here (rather than in each policy) revokes access everywhere at once. '
  'See 115_staff_login_revocation.sql.';

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- 1. As an active, login-enabled staff member: any staff RPC/query
--    still works (no regression).
-- 2. Set login_enabled = false on that staff row. The SAME staff
--    session (no new sign-in needed — this is checked on every call,
--    not at login time) immediately loses access: sculpt_issue_checkin_
--    token / sculpt_manual_checkin return NOT_AUTHORIZED, and any
--    staff_* RLS-gated SELECT returns zero rows.
-- 3. Set login_enabled back to true, is_active = false instead —
--    same result: access is revoked.
-- 4. Restore both to true — access returns, no separate re-grant step.
-- ═══════════════════════════════════════════════════════════════
