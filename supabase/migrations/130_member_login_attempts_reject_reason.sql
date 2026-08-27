-- ═══════════════════════════════════════════════════════════════
-- Migration 130 — record WHY a member login attempt was rejected
-- ═══════════════════════════════════════════════════════════════
-- 2026-08-27 client demo: a real member's login failed with the one
-- generic "Application number or phone number not recognised" message
-- member-signin/index.ts returns for five different rejection paths on
-- purpose (see its header comment — diverging the message would make
-- it a member-enumeration oracle). That's correct for the CLIENT, but
-- it meant diagnosing the demo failure took querying member_login_attempts
-- and cross-referencing gym_id (null = gym lookup failed) by hand —
-- which is in fact how the real cause (GYM_CODE drift, see
-- src/lib/member-auth.js) was proven, but it shouldn't take that long
-- next time.
--
-- This column is server-only (member_login_attempts already has no
-- client SELECT policy — it's written by the service-role edge function
-- and nothing else reads it) so recording the specific reason here does
-- NOT weaken the enumeration boundary; the HTTP response the client
-- sees is unchanged.
--
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.member_login_attempts
  ADD COLUMN IF NOT EXISTS reject_reason text;

COMMENT ON COLUMN public.member_login_attempts.reject_reason IS
  'Server-only diagnostic, never exposed to the client: one of '
  'RATE_LIMITED, MISSING_FIELDS, NO_GYM, NO_MEMBER, PHONE_MISMATCH, '
  'or null for a successful attempt. See member-signin/index.ts.';

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════
-- select reject_reason, count(*) from member_login_attempts
--   group by reject_reason order by 2 desc;
-- After redeploying member-signin and one deliberately-wrong login
-- attempt (right app number, wrong phone), the newest row's
-- reject_reason is 'PHONE_MISMATCH', not null.
-- ═══════════════════════════════════════════════════════════════
