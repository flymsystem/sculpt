-- ─────────────────────────────────────────────────────────────────
-- 102_public_plans_showcase.sql
--
-- Lets the PUBLIC landing page show the membership plans the owner
-- configures in Plan Settings, so pricing lives in exactly one place.
--
-- WHY AN RPC AND NOT AN RLS POLICY ON `plans`:
-- Adding an anon SELECT policy to `plans` would open the whole row —
-- every column, for every gym — to anyone holding the anon key. This
-- function is SECURITY DEFINER with a fixed, narrow projection instead:
-- it returns four marketing columns for one gym, looked up by gym code,
-- and nothing else. `plans` itself stays closed to anonymous readers.
--
-- WHAT IT EXPOSES: plan name, duration, price, features — the same
-- information a gym prints on a poster in its own reception.
-- WHAT IT DOES NOT EXPOSE: member data, payments, expenses, staff,
-- gym contact rows, internal ids, or any inactive/archived plan.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────

-- ── Opt-out switch ───────────────────────────────────────────────
-- Defaults TRUE so the landing page works immediately after this runs.
-- An owner who does not want public pricing sets this to FALSE and the
-- landing membership section disappears on its own.
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS public_plans_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN gyms.public_plans_enabled IS
  'When false, public_gym_plans() returns no rows for this gym and the '
  'marketing site hides its membership section.';

-- ── The reader ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public_gym_plans(TEXT);

CREATE FUNCTION public_gym_plans(p_gym_code TEXT)
RETURNS TABLE (
  name            TEXT,
  duration_months INT,
  price           NUMERIC(10,2),
  features        TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pin the search path: a SECURITY DEFINER function that resolves its
-- own table names through a caller-controlled search_path is the
-- classic privilege-escalation hole.
SET search_path = public, pg_temp
AS $$
  SELECT p.name, p.duration_months, p.price, p.features
  FROM plans p
  JOIN gyms g ON g.id = p.gym_id
  WHERE g.gym_code = p_gym_code
    AND g.is_active
    AND g.public_plans_enabled
    AND p.is_active
  ORDER BY p.duration_months, p.price;
$$;

COMMENT ON FUNCTION public_gym_plans(TEXT) IS
  'Read-only marketing projection of active plans for one gym, by gym '
  'code. Used by the public landing page. Exposes no member, payment or '
  'staff data.';

-- Anonymous visitors and signed-in users may both call it. Nothing else
-- about `plans` becomes reachable.
REVOKE ALL ON FUNCTION public_gym_plans(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_gym_plans(TEXT) TO anon, authenticated;
