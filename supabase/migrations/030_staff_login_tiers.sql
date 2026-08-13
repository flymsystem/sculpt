-- ═══════════════════════════════════════════════════════════════
-- Migration 030 — Staff Login + Subscription Tiers
-- ═══════════════════════════════════════════════════════════════
-- This migration adds:
--   1. subscription_tier column on gyms (core/pro gating)
--   2. user_id + login_enabled columns on staff (staff auth link)
--   3. get_my_gym_id_as_staff() helper function
--   4. is_gym_owner() helper function
--   5. RLS policies for staff access on relevant tables
--
-- SAFE FOR EXISTING CLIENTS: subscription_tier defaults to 'core',
-- staff.user_id defaults to NULL, no existing policies are changed.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Subscription Tier on Gyms ─────────────────────────────
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'core';

-- Add CHECK constraint safely (look up if it exists first)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gyms_subscription_tier_check'
      AND conrelid = 'public.gyms'::regclass
  ) THEN
    ALTER TABLE gyms ADD CONSTRAINT gyms_subscription_tier_check
      CHECK (subscription_tier IN ('core', 'pro'));
  END IF;
END $$;


-- ─── 2. Staff Auth Link ───────────────────────────────────────
ALTER TABLE staff ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS login_enabled boolean NOT NULL DEFAULT false;

-- Unique constraint on user_id (one auth account per staff)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_user_id_unique'
      AND conrelid = 'public.staff'::regclass
  ) THEN
    ALTER TABLE staff ADD CONSTRAINT staff_user_id_unique UNIQUE (user_id);
  END IF;
END $$;


-- ─── 3. Helper Functions ──────────────────────────────────────

-- Returns gym_id if the current user is a staff member
CREATE OR REPLACE FUNCTION get_my_gym_id_as_staff()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gym_id
  FROM public.gym_users
  WHERE user_id = auth.uid()
    AND role = 'staff'
  LIMIT 1;
$$;

-- Returns TRUE if the current user is a gym owner
CREATE OR REPLACE FUNCTION is_gym_owner()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_users
    WHERE user_id = auth.uid()
      AND role = 'owner'
  );
$$;

-- Returns the user's role (admin/owner/staff)
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.gym_users
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;


-- ─── 4. RLS Policies for Staff ────────────────────────────────
-- Strategy: Add NEW policies alongside existing ones. Never touch
-- existing owner/admin policies. Staff policies are purely additive.

-- ── gym_users: staff can read their own row ──
-- Already covered by "users_read_own_row" USING (user_id = auth.uid())
-- No change needed.

-- ── gyms: staff can read their own gym ──
DROP POLICY IF EXISTS "staff_read_own_gym" ON gyms;
CREATE POLICY "staff_read_own_gym" ON gyms
  FOR SELECT USING (id = get_my_gym_id_as_staff());

-- ── members: staff can read, add, edit (NOT delete) ──
DROP POLICY IF EXISTS "staff_read_members" ON members;
CREATE POLICY "staff_read_members" ON members
  FOR SELECT USING (gym_id = get_my_gym_id_as_staff());

DROP POLICY IF EXISTS "staff_insert_members" ON members;
CREATE POLICY "staff_insert_members" ON members
  FOR INSERT WITH CHECK (gym_id = get_my_gym_id_as_staff());

DROP POLICY IF EXISTS "staff_update_members" ON members;
CREATE POLICY "staff_update_members" ON members
  FOR UPDATE USING (gym_id = get_my_gym_id_as_staff());
-- Note: soft-delete (is_active=false) is an UPDATE — gated at application level,
-- not RLS. Staff cannot set is_active=false or cancelled_at via the UI.

-- ── plans: staff can VIEW only (no insert/update/delete) ──
DROP POLICY IF EXISTS "staff_read_plans" ON plans;
CREATE POLICY "staff_read_plans" ON plans
  FOR SELECT USING (gym_id = get_my_gym_id_as_staff());

-- ── payment_history: staff can read + insert (for renewals/clear balance) ──
DROP POLICY IF EXISTS "staff_read_payments" ON payment_history;
CREATE POLICY "staff_read_payments" ON payment_history
  FOR SELECT USING (gym_id = get_my_gym_id_as_staff());

DROP POLICY IF EXISTS "staff_insert_payments" ON payment_history;
CREATE POLICY "staff_insert_payments" ON payment_history
  FOR INSERT WITH CHECK (gym_id = get_my_gym_id_as_staff());

-- ── enquiries: staff can read, add, edit ──
DROP POLICY IF EXISTS "staff_read_enquiries" ON enquiries;
CREATE POLICY "staff_read_enquiries" ON enquiries
  FOR SELECT USING (gym_id = get_my_gym_id_as_staff());

DROP POLICY IF EXISTS "staff_insert_enquiries" ON enquiries;
CREATE POLICY "staff_insert_enquiries" ON enquiries
  FOR INSERT WITH CHECK (gym_id = get_my_gym_id_as_staff());

DROP POLICY IF EXISTS "staff_update_enquiries" ON enquiries;
CREATE POLICY "staff_update_enquiries" ON enquiries
  FOR UPDATE USING (gym_id = get_my_gym_id_as_staff());

-- ── expenses: staff can read + add (no edit/delete) ──
DROP POLICY IF EXISTS "staff_read_expenses" ON expenses;
CREATE POLICY "staff_read_expenses" ON expenses
  FOR SELECT USING (gym_id = get_my_gym_id_as_staff());

DROP POLICY IF EXISTS "staff_insert_expenses" ON expenses;
CREATE POLICY "staff_insert_expenses" ON expenses
  FOR INSERT WITH CHECK (gym_id = get_my_gym_id_as_staff());

-- ── staff table: staff can read own gym's staff list ──
DROP POLICY IF EXISTS "staff_read_staff" ON staff;
CREATE POLICY "staff_read_staff" ON staff
  FOR SELECT USING (gym_id = get_my_gym_id_as_staff());

-- ── staff_attendance: staff can read + insert + update own gym ──
DROP POLICY IF EXISTS "staff_read_attendance" ON staff_attendance;
CREATE POLICY "staff_read_attendance" ON staff_attendance
  FOR SELECT USING (gym_id = get_my_gym_id_as_staff());

DROP POLICY IF EXISTS "staff_insert_attendance" ON staff_attendance;
CREATE POLICY "staff_insert_attendance" ON staff_attendance
  FOR INSERT WITH CHECK (gym_id = get_my_gym_id_as_staff());

DROP POLICY IF EXISTS "staff_update_attendance" ON staff_attendance;
CREATE POLICY "staff_update_attendance" ON staff_attendance
  FOR UPDATE USING (gym_id = get_my_gym_id_as_staff());

-- ── member_addons: staff can read + insert (for add/edit member) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'member_addons' AND table_schema = 'public') THEN
    EXECUTE 'DROP POLICY IF EXISTS "staff_read_addons" ON member_addons';
    EXECUTE 'CREATE POLICY "staff_read_addons" ON member_addons FOR SELECT USING (gym_id = get_my_gym_id_as_staff())';
    EXECUTE 'DROP POLICY IF EXISTS "staff_insert_addons" ON member_addons';
    EXECUTE 'CREATE POLICY "staff_insert_addons" ON member_addons FOR INSERT WITH CHECK (gym_id = get_my_gym_id_as_staff())';
  END IF;
END $$;

-- ── addon_templates: staff can read (for member forms) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'addon_templates' AND table_schema = 'public') THEN
    EXECUTE 'DROP POLICY IF EXISTS "staff_read_addon_templates" ON addon_templates';
    EXECUTE 'CREATE POLICY "staff_read_addon_templates" ON addon_templates FOR SELECT USING (gym_id = get_my_gym_id_as_staff())';
  END IF;
END $$;

-- ── activity_log: staff can insert (for logging actions) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_log' AND table_schema = 'public') THEN
    EXECUTE 'DROP POLICY IF EXISTS "staff_insert_activity" ON activity_log';
    EXECUTE 'CREATE POLICY "staff_insert_activity" ON activity_log FOR INSERT WITH CHECK (gym_id = get_my_gym_id_as_staff())';
  END IF;
END $$;

-- ── Storage: staff can access member-photos and aadhar-photos ──
-- (Storage policies use storage.objects — handled via Supabase Dashboard)
-- Staff needs INSERT/SELECT on member-photos and aadhar-photos buckets.
-- Add these via Dashboard > Storage > Policies if not already set.


-- ─── 5. Update members_with_status view ───────────────────────
-- No column changes to members table in this migration,
-- so the view does NOT need to be recreated.


-- ═══════════════════════════════════════════════════════════════
-- END OF MIGRATION 030
-- Next migration number: 031
-- ═══════════════════════════════════════════════════════════════
