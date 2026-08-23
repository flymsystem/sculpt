-- ═══════════════════════════════════════════════════════════════
-- Migration 123 — staff RLS gaps: can soft-delete members via the API
-- despite the UI hiding the button, and can read the gym's full
-- historical revenue via payment_history despite Finance being
-- UI-gated
-- ═══════════════════════════════════════════════════════════════
-- FIX-PROMPT.md items 14 and 15. permissions.js already denies staff
-- 'delete_member' and gates the Finance route (dashboard/index.js's
-- nav() checks hasAccess() before rendering any section, including
-- 'finance') — both real, working UI guards. The gap is underneath:
-- RLS trusted the UI in both cases.
--
-- Item 14: staff_update_members (101/baseline) has USING but no
-- WITH CHECK — nothing stops a direct API call setting is_active =
-- false, which is exactly what deleteMember() does. Staff never need
-- to write is_active at all (the app only ever flips it via the
-- owner-gated delete flow), so the fix is a WITH CHECK that requires
-- the row stay active.
--
-- Item 15: staff_read_payments (101/baseline) has no scoping beyond
-- gym_id — full SELECT on every payment ever recorded, i.e. the gym's
-- entire revenue history, one API call away regardless of the Finance
-- route guard. But the UI legitimately needs staff to see the last
-- payment(s) just collected (member-modals.js refetches payment
-- history right after clearBalance/renewMember to update the member's
-- own receipts view) — client decision: scope staff's SELECT to
-- payments made TODAY, in the gym's own timezone (CLAUDE.md's
-- established pattern — see 106_staff_checkin.sql), not gym-wide
-- history. Owner access (owner_all_own_payments) is untouched.
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "staff_update_members" ON public.members;
CREATE POLICY staff_update_members ON public.members
  FOR UPDATE
  USING (gym_id = public.get_my_gym_id_as_staff())
  WITH CHECK (gym_id = public.get_my_gym_id_as_staff() AND is_active = true);

DROP POLICY IF EXISTS "staff_read_payments" ON public.payment_history;
CREATE POLICY staff_read_payments ON public.payment_history
  FOR SELECT
  USING (
    gym_id = public.get_my_gym_id_as_staff()
    AND paid_at >= (
      date_trunc('day', now() AT TIME ZONE coalesce(
        (SELECT g.timezone FROM public.gyms g WHERE g.id = payment_history.gym_id),
        'Asia/Kolkata'
      )) AT TIME ZONE coalesce(
        (SELECT g.timezone FROM public.gyms g WHERE g.id = payment_history.gym_id),
        'Asia/Kolkata'
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- 1. As staff, try `update members set is_active = false where id = ...`
--    directly (e.g. via the browser console using the app's supabase
--    client) — must be rejected by RLS, not just hidden in the UI.
-- 2. As staff, collect a payment today — it must show up in that
--    member's receipts view immediately (staff_read_payments allows it,
--    paid_at is today).
-- 3. As staff, query payment_history for last month directly — must
--    return zero rows.
-- ═══════════════════════════════════════════════════════════════
