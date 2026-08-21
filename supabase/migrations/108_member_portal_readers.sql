-- ─────────────────────────────────────────────────────────────────
-- 108_member_portal_readers.sql
--
-- Narrow SECURITY DEFINER projections for the member portal, modelled
-- on public_gym_plans() in migration 102. sculpt_my_membership() has
-- to be SECURITY DEFINER because it reads gym name/logo from `gyms`,
-- and members must NEVER get a SELECT policy on that table — it holds
-- owner_password in plaintext (migration 022). The other two don't
-- strictly need the elevation (member RLS already permits reading
-- their own member_checkins / payment_history rows), but they're kept
-- SECURITY DEFINER anyway and always filter by get_my_member_id()
-- internally, ignoring anything caller-supplied, so there is exactly
-- one pattern to reason about across all three.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sculpt_my_membership();
CREATE FUNCTION sculpt_my_membership()
RETURNS TABLE (
  gym_name           text,
  gym_logo_url       text,
  member_name        text,
  application_number text,
  plan_name          text,
  join_date          date,
  expiry_date        date,
  days_remaining     int,
  balance_due        numeric,
  payment_status     text,
  computed_status    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    g.name, g.logo_url,
    m.full_name, m.application_number, m.plan_name, m.join_date, m.expiry_date,
    CASE WHEN m.expiry_date IS NOT NULL THEN (m.expiry_date - CURRENT_DATE) ELSE NULL END,
    m.balance_due, m.payment_status,
    CASE
      WHEN m.cancelled_at IS NOT NULL THEN 'Cancelled'
      WHEN m.member_type = 'Trial' AND m.expiry_date IS NOT NULL AND m.expiry_date < CURRENT_DATE THEN 'Expired'
      WHEN m.member_type = 'Trial' THEN 'Trial'
      WHEN m.expiry_date IS NOT NULL AND m.expiry_date < CURRENT_DATE THEN 'Expired'
      WHEN m.expiry_date IS NOT NULL AND m.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'Expiring'
      WHEN m.payment_status = 'Due' THEN 'Due'
      ELSE 'Active'
    END
  FROM members m
  JOIN gyms g ON g.id = m.gym_id
  WHERE m.id = get_my_member_id();
$$;

COMMENT ON FUNCTION sculpt_my_membership() IS
  'Read-only projection for the signed-in member''s own row plus their '
  'gym''s public name/logo. Never exposes gyms.owner_password or any '
  'other gym column. Returns zero rows for a non-member session.';

REVOKE ALL ON FUNCTION sculpt_my_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_my_membership() TO authenticated;

DROP FUNCTION IF EXISTS sculpt_my_visits(int);
CREATE FUNCTION sculpt_my_visits(p_limit int DEFAULT 20)
RETURNS TABLE (
  checked_in_at timestamptz,
  status        text,
  source        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.checked_in_at, c.status, c.source
  FROM member_checkins c
  WHERE c.member_id = get_my_member_id()
  ORDER BY c.checked_in_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
$$;

REVOKE ALL ON FUNCTION sculpt_my_visits(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_my_visits(int) TO authenticated;

DROP FUNCTION IF EXISTS sculpt_my_receipts();
CREATE FUNCTION sculpt_my_receipts()
RETURNS TABLE (
  id           uuid,
  amount       numeric,
  payment_mode text,
  plan_name    text,
  paid_at      timestamptz,
  notes        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.amount, p.payment_mode, p.plan_name, p.paid_at, p.notes
  FROM payment_history p
  WHERE p.member_id = get_my_member_id()
  ORDER BY p.paid_at DESC
  LIMIT 200;
$$;

COMMENT ON FUNCTION sculpt_my_receipts() IS
  'The member''s own payment history, newest first. There is no durable '
  'invoice-number/storage-path record in this schema (PDFs are generated '
  'on demand from payment_history and uploaded with a throwaway invoice '
  'number — see genInvoiceNo() in helpers.js) so this returns the payment '
  'rows themselves; the member portal separately lists any already-'
  'generated PDFs from the invoices bucket via a signed URL (migration '
  '110), which is best-effort and not guaranteed to exist for every row.';

REVOKE ALL ON FUNCTION sculpt_my_receipts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sculpt_my_receipts() TO authenticated;
