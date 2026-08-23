-- ═══════════════════════════════════════════════════════════════
-- Migration 122 — expiry_date can never be edited; correct base date
-- for renewing a still-active membership
-- ═══════════════════════════════════════════════════════════════
-- FIX-PROMPT.md items 10 and 11 share one root cause: set_member_expiry()
-- (the trigger behind trg_member_expiry, BEFORE INSERT OR UPDATE ON
-- members) unconditionally recomputes
-- expiry_date := join_date + plan_duration_months
-- on every single UPDATE to a non-Trial member, with no check for
-- whether join_date or plan_duration_months actually changed. Any
-- explicit expiry_date a caller sets gets silently overwritten in the
-- same statement — there was never a working way to hand-edit it.
--
-- Fix: only auto-recompute when this is a fresh INSERT, or when
-- join_date or plan_duration_months is actually changing. A caller
-- that sets expiry_date directly while leaving those two columns alone
-- (the new Edit Member expiry field, added in the same commit as this
-- migration) now has that value stick.
--
-- This also fixes item 11 (renewal date) — no DB change was needed
-- there once the trigger respects its inputs: the client fix (in
-- member-modals.js, same commit) now sends join_date = the member's
-- *current* expiry date when they're still active (so
-- expiry + duration, not today + duration), or today's date if already
-- expired/cancelled. The trigger just does the same join_date + duration
-- math it always did — see helpers.js's computeRenewalBase().
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_member_expiry() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.plan_duration_months IS NOT NULL AND NEW.plan_duration_months > 0
     AND NEW.join_date IS NOT NULL
     AND NEW.member_type != 'Trial'
     AND (
       TG_OP = 'INSERT'
       OR NEW.join_date IS DISTINCT FROM OLD.join_date
       OR NEW.plan_duration_months IS DISTINCT FROM OLD.plan_duration_months
     )
  THEN
    NEW.expiry_date := (NEW.join_date + (NEW.plan_duration_months || ' months')::INTERVAL)::DATE;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- 1. Edit a Paid member's expiry date directly (new field in Edit
--    Member) without touching join date/plan — saved value must stick
--    after a refresh, not silently revert to join_date + duration.
-- 2. Renew a still-ACTIVE member (expiry 20 days out) with a 1-month
--    plan — new expiry must be old_expiry + 1 month, not today + 1 month.
-- 3. Renew an EXPIRED member with a 1-month plan — new expiry must be
--    today + 1 month.
-- 4. Renew a member whose expiry is exactly today — must be treated as
--    still active (today + duration = same as expiring-today branch of
--    "active"), per computeRenewalBase()'s inclusive comparison.
-- ═══════════════════════════════════════════════════════════════
