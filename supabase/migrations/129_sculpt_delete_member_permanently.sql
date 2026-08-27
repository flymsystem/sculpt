-- ═══════════════════════════════════════════════════════════════
-- Migration 129 — a real "erase this, it was a mistake" path
-- ═══════════════════════════════════════════════════════════════
-- Client-demo bug: three test members were added and then Removed
-- (the existing soft delete — is_active=false, see deleteMember() in
-- src/lib/members.js). Their ₹2,500 test payments correctly kept
-- showing in Finance/Overview after that, because migration 121 made
-- revenue aggregate payment_history directly with no join to members
-- at all — deliberately, so a real member leaving the gym doesn't
-- erase their historical revenue. That is correct accounting and
-- must not be reverted.
--
-- What was missing is the OTHER intent: "this was a mistake or a
-- test entry, it should never have counted, erase it." The app only
-- offered Remove (soft delete, keep the money), and staff had no way
-- to express "actually undo this" once relying on 121's semantics.
--
-- This function is that second, deliberately harder path:
--   - owner-only (is_gym_owner() / get_my_gym_id()) — the "delete
--     permanently" wording in the UI is gated the same way, but the
--     real boundary is here, not in the client.
--   - a genuine hard DELETE of the members row. Every FK from
--     payment_history, reminder_logs and member_checkins to members.id
--     is ON DELETE CASCADE (see migration 001/033), so this removes
--     the member's payment history from revenue totals for real —
--     unlike Remove, which never touches payment_history.
--   - RETURNS a status row rather than RAISEing, same convention as
--     every other member-facing money/membership function in this
--     schema (see CLAUDE.md "Check-in functions RETURN a status") —
--     a RAISE would roll back nothing here since this path IS the
--     destructive action, but returning a typed reason lets the
--     client show a real message instead of a generic RPC error.
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sculpt_delete_member_permanently(
  p_member_id uuid,
  p_gym_id uuid
) RETURNS TABLE(out_status text, out_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_gym_id uuid;
BEGIN
  v_owner_gym_id := public.get_my_gym_id();

  IF v_owner_gym_id IS NULL OR v_owner_gym_id <> p_gym_id THEN
    RETURN QUERY SELECT 'NOT_AUTHORIZED'::text,
      'Only the gym owner can permanently delete a member.'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.members m WHERE m.id = p_member_id AND m.gym_id = p_gym_id
  ) THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, 'Member not found.'::text;
    RETURN;
  END IF;

  DELETE FROM public.members WHERE id = p_member_id AND gym_id = p_gym_id;

  RETURN QUERY SELECT 'OK'::text,
    'Member and all their payment history were permanently deleted.'::text;
END;
$$;

COMMENT ON FUNCTION public.sculpt_delete_member_permanently(uuid, uuid) IS
  'Owner-only hard delete: removes a members row and (via ON DELETE '
  'CASCADE) every payment_history/reminder_logs/member_checkins row '
  'tied to it. For erasing mistaken/test entries only — Remove '
  '(is_active=false, src/lib/members.js deleteMember) stays the normal '
  'path and is what keeps historical revenue intact per migration 121.';

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- 1. As owner: add a member, record a payment, call this function with
--    their id. sculpt_revenue_summary's total_amount drops by that
--    payment's amount. select * from members / payment_history for
--    that id returns zero rows.
-- 2. As staff (non-owner): calling this function returns
--    ('NOT_AUTHORIZED', ...) and the member row is untouched.
-- 3. Calling it twice with the same id: second call returns
--    ('NOT_FOUND', ...), no error thrown.
-- ═══════════════════════════════════════════════════════════════
