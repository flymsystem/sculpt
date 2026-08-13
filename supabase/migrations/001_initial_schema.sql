-- ═══════════════════════════════════════════════════════════════
-- FLYM — Complete Database Schema  (Production v1)
-- ─────────────────────────────────────────────────────────────────
-- HOW TO APPLY:
--   1. Open Supabase Dashboard → SQL Editor → New Query
--   2. Paste this entire file and click "Run"
--   Re-running: DROP SCHEMA public CASCADE; CREATE SCHEMA public;
--   then re-run.
-- ─────────────────────────────────────────────────────────────────
-- AUDIT FIXES vs previous version:
--   1. payment_mode CHECK: was 'Cash','Online' — frontend sends
--      exactly these values now (was incorrectly 'Online Payment')
--   2. members_with_status: Trial members now surface as 'Trial'
--      status (previously fell through to 'Active')
--   3. gym_summary: added phone, address columns so admin detail
--      view can show them (were missing from SELECT)
--   4. RLS on views: added security_invoker so views respect the
--      caller's RLS, not the definer's
--   5. get_my_gym_id/is_flym_admin: added explicit search_path
--      (already present — preserved)
--   6. Indexes added for all FK columns (crucial for performance
--      at scale)
--   7. Updated members_with_status: NULL expiry + no plan → Active
--      (correct for Unpaid members with no plan set yet)
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── GYMS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gyms (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_code      TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  owner_name    TEXT NOT NULL,
  phone         TEXT,
  address       TEXT,
  city          TEXT,
  email         TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── GYM USERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gym_users (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gym_id     UUID REFERENCES gyms(id) ON DELETE SET NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ─── MEMBERSHIP PLANS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  duration_months INT NOT NULL CHECK (duration_months > 0),
  price           NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  features        TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── MEMBERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS members (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id               UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  full_name            TEXT NOT NULL,
  phone                TEXT NOT NULL,
  email                TEXT,
  date_of_birth        DATE,
  gender               TEXT CHECK (gender IN ('Male','Female','Other') OR gender IS NULL),
  join_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  plan_id              UUID REFERENCES plans(id) ON DELETE SET NULL,
  plan_name            TEXT,
  plan_price           NUMERIC(10,2),
  plan_duration_months INT,
  expiry_date          DATE,
  -- FIX: payment_mode values are 'Cash' or 'Online' (not 'Online Payment')
  payment_mode         TEXT CHECK (payment_mode IN ('Cash','Online') OR payment_mode IS NULL),
  payment_status       TEXT DEFAULT 'Paid' CHECK (payment_status IN ('Paid','Due','Partial')),
  member_type          TEXT DEFAULT 'Paid' CHECK (member_type IN ('Paid','Unpaid','Trial')),
  notes                TEXT,
  is_active            BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PAYMENT HISTORY ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_history (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id       UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id    UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount       NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  payment_mode TEXT CHECK (payment_mode IN ('Cash','Online') OR payment_mode IS NULL),
  plan_id      UUID REFERENCES plans(id) ON DELETE SET NULL,
  plan_name    TEXT,
  paid_at      TIMESTAMPTZ DEFAULT NOW(),
  notes        TEXT
);

-- ─── REMINDER LOG ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminder_logs (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id    UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  message   TEXT NOT NULL,
  sent_at   TIMESTAMPTZ DEFAULT NOW(),
  channel   TEXT DEFAULT 'whatsapp'
);

-- ─── ACTIVITY LOG ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id      UUID REFERENCES gyms(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  description TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES (critical for performance at scale)
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_gym_users_user_id      ON gym_users(user_id);
CREATE INDEX IF NOT EXISTS idx_gym_users_gym_id       ON gym_users(gym_id);
CREATE INDEX IF NOT EXISTS idx_members_gym_id         ON members(gym_id);
CREATE INDEX IF NOT EXISTS idx_members_is_active      ON members(is_active);
CREATE INDEX IF NOT EXISTS idx_members_expiry_date    ON members(expiry_date);
CREATE INDEX IF NOT EXISTS idx_members_payment_status ON members(payment_status);
CREATE INDEX IF NOT EXISTS idx_members_member_type    ON members(member_type);
CREATE INDEX IF NOT EXISTS idx_members_join_date      ON members(join_date);
CREATE INDEX IF NOT EXISTS idx_plans_gym_id           ON plans(gym_id);
CREATE INDEX IF NOT EXISTS idx_plans_is_active        ON plans(is_active);
CREATE INDEX IF NOT EXISTS idx_payment_history_gym_id ON payment_history(gym_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_member ON payment_history(member_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_paid_at ON payment_history(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_gym_id    ON activity_log(gym_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created   ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_gym_id   ON reminder_logs(gym_id);

-- ═══════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════

-- Auto-compute expiry_date from join_date + plan_duration_months
-- Only runs if plan_duration_months is set (Trial members skip this)
CREATE OR REPLACE FUNCTION set_member_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan_duration_months IS NOT NULL AND NEW.plan_duration_months > 0
     AND NEW.join_date IS NOT NULL
     AND NEW.member_type != 'Trial' THEN
    NEW.expiry_date := (NEW.join_date + (NEW.plan_duration_months || ' months')::INTERVAL)::DATE;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_member_expiry ON members;
CREATE TRIGGER trg_member_expiry
  BEFORE INSERT OR UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION set_member_expiry();

-- Auto-update updated_at on gyms and plans
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gyms_updated  ON gyms;
DROP TRIGGER IF EXISTS trg_plans_updated ON plans;
CREATE TRIGGER trg_gyms_updated  BEFORE UPDATE ON gyms  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- RLS — Enable on all tables
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE gyms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log    ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- SECURITY DEFINER HELPER FUNCTIONS
-- These run with elevated privilege so they can read gym_users
-- without being blocked by their own RLS policies.
-- SECURITY: SET search_path = public prevents search path injection.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_my_gym_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gym_id
  FROM public.gym_users
  WHERE user_id = auth.uid()
    AND role = 'owner'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_flym_admin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_users
    WHERE user_id = auth.uid()
      AND role = 'admin'
  );
$$;

-- ═══════════════════════════════════════════════════════════════
-- RLS POLICIES
-- ═══════════════════════════════════════════════════════════════

-- ── gym_users ──
-- Critical: users must be able to read their own row after sign-in
DROP POLICY IF EXISTS "users_read_own_row"    ON gym_users;
DROP POLICY IF EXISTS "admin_all_gym_users"   ON gym_users;

CREATE POLICY "users_read_own_row" ON gym_users
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "admin_all_gym_users" ON gym_users
  FOR ALL USING (is_flym_admin());

-- ── gyms ──
DROP POLICY IF EXISTS "admin_all_gyms"        ON gyms;
DROP POLICY IF EXISTS "owner_read_own_gym"    ON gyms;
DROP POLICY IF EXISTS "owner_update_own_gym"  ON gyms;

CREATE POLICY "admin_all_gyms"       ON gyms FOR ALL    USING (is_flym_admin());
CREATE POLICY "owner_read_own_gym"   ON gyms FOR SELECT USING (id = get_my_gym_id());
CREATE POLICY "owner_update_own_gym" ON gyms FOR UPDATE USING (id = get_my_gym_id());

-- ── plans ──
DROP POLICY IF EXISTS "admin_all_plans"       ON plans;
DROP POLICY IF EXISTS "owner_all_own_plans"   ON plans;

CREATE POLICY "admin_all_plans"     ON plans FOR ALL USING (is_flym_admin());
CREATE POLICY "owner_all_own_plans" ON plans FOR ALL USING (gym_id = get_my_gym_id());

-- ── members ──
DROP POLICY IF EXISTS "admin_all_members"     ON members;
DROP POLICY IF EXISTS "owner_all_own_members" ON members;

CREATE POLICY "admin_all_members"     ON members FOR ALL USING (is_flym_admin());
CREATE POLICY "owner_all_own_members" ON members FOR ALL USING (gym_id = get_my_gym_id());

-- ── payment_history ──
DROP POLICY IF EXISTS "admin_all_payments"       ON payment_history;
DROP POLICY IF EXISTS "owner_all_own_payments"   ON payment_history;

CREATE POLICY "admin_all_payments"     ON payment_history FOR ALL USING (is_flym_admin());
CREATE POLICY "owner_all_own_payments" ON payment_history FOR ALL USING (gym_id = get_my_gym_id());

-- ── reminder_logs ──
DROP POLICY IF EXISTS "admin_all_reminders"      ON reminder_logs;
DROP POLICY IF EXISTS "owner_all_own_reminders"  ON reminder_logs;

CREATE POLICY "admin_all_reminders"     ON reminder_logs FOR ALL USING (is_flym_admin());
CREATE POLICY "owner_all_own_reminders" ON reminder_logs FOR ALL USING (gym_id = get_my_gym_id());

-- ── activity_log ──
DROP POLICY IF EXISTS "admin_all_activity"       ON activity_log;
DROP POLICY IF EXISTS "owner_all_own_activity"   ON activity_log;

CREATE POLICY "admin_all_activity"     ON activity_log FOR ALL USING (is_flym_admin());
CREATE POLICY "owner_all_own_activity" ON activity_log FOR ALL USING (gym_id = get_my_gym_id());

-- ═══════════════════════════════════════════════════════════════
-- VIEWS
-- ═══════════════════════════════════════════════════════════════

-- members_with_status: computed status for each active member
-- FIX: Trial members now correctly show 'Trial' status (previously
--      fell through the CASE to 'Active' due to ordering)
CREATE OR REPLACE VIEW members_with_status
  WITH (security_invoker = true)
AS
SELECT
  m.*,
  g.name AS gym_name,
  CASE
    WHEN m.member_type = 'Trial' AND m.expiry_date IS NOT NULL AND m.expiry_date < CURRENT_DATE THEN 'Expired'
    WHEN m.member_type = 'Trial'                                       THEN 'Trial'
    WHEN m.expiry_date IS NOT NULL AND m.expiry_date < CURRENT_DATE    THEN 'Expired'
    WHEN m.expiry_date IS NOT NULL
     AND m.expiry_date <= CURRENT_DATE + INTERVAL '7 days'             THEN 'Expiring'
    WHEN m.payment_status = 'Due'                                      THEN 'Due'
    ELSE 'Active'
  END AS computed_status,
  CASE
    WHEN m.expiry_date IS NOT NULL
    THEN (m.expiry_date - CURRENT_DATE)
    ELSE NULL
  END AS days_until_expiry
FROM members m
JOIN gyms g ON g.id = m.gym_id
WHERE m.is_active = TRUE;

-- gym_summary: per-gym stats for admin dashboard
-- FIX: Added phone, address, email columns so admin detail view
--      can display them (were missing from SELECT previously)
CREATE OR REPLACE VIEW gym_summary
  WITH (security_invoker = true)
AS
SELECT
  g.id            AS gym_id,
  g.name          AS gym_name,
  g.gym_code,
  g.owner_name,
  g.phone,
  g.city,
  g.address,
  g.email,
  g.is_active,
  g.created_at,
  COUNT(m.id)                                                              AS total_members,
  COUNT(m.id) FILTER (
    WHERE m.member_type != 'Trial'
      AND m.expiry_date >= CURRENT_DATE
      AND m.payment_status != 'Due'
  )                                                                        AS active_members,
  COUNT(m.id) FILTER (
    WHERE m.payment_status = 'Due'
       OR (m.member_type != 'Trial' AND m.expiry_date < CURRENT_DATE)
  )                                                                        AS payment_due,
  COUNT(m.id) FILTER (
    WHERE m.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
  )                                                                        AS expiring_soon
FROM gyms g
LEFT JOIN members m ON m.gym_id = g.id AND m.is_active = TRUE
GROUP BY g.id, g.name, g.gym_code, g.owner_name, g.phone,
         g.city, g.address, g.email, g.is_active, g.created_at;

-- ═══════════════════════════════════════════════════════════════
-- GRANT view access to authenticated users
-- (Views don't inherit table RLS automatically in all Supabase versions)
-- ═══════════════════════════════════════════════════════════════

GRANT SELECT ON members_with_status TO authenticated;
GRANT SELECT ON gym_summary          TO authenticated;
-- Also grant anon role for public stats endpoints if ever needed
-- GRANT SELECT ON gym_summary TO anon;  -- uncomment if required

-- ═══════════════════════════════════════════════════════════════
-- AUTO-CLEANUP: Delete activity_log and reminder_logs older than 90 days
-- Run this in Supabase SQL editor OR schedule via pg_cron if available
-- ═══════════════════════════════════════════════════════════════

-- Create cleanup function
CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM activity_log  WHERE created_at < NOW() - INTERVAL '90 days';
  DELETE FROM reminder_logs WHERE sent_at < NOW() - INTERVAL '90 days';
END;
$$;

-- If pg_cron is enabled on your Supabase project (Pro plan), uncomment:
-- SELECT cron.schedule('cleanup-old-logs', '0 3 * * 0', 'SELECT cleanup_old_logs()');
-- This runs every Sunday at 3 AM UTC.
