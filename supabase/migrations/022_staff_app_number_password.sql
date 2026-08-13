-- Migration 022: Staff management, application number, owner password
-- Run in Supabase SQL editor. Idempotent.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Application number on members (optional, unique per gym)
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'members' AND column_name = 'application_number'
  ) THEN
    ALTER TABLE members ADD COLUMN application_number text;
  END IF;
END $$;

-- Unique per gym (only among active members, nulls allowed)
DROP INDEX IF EXISTS idx_members_app_number_gym;
CREATE UNIQUE INDEX idx_members_app_number_gym
  ON members (gym_id, application_number)
  WHERE application_number IS NOT NULL AND is_active = true;

-- Recreate members_with_status view to include application_number
DROP VIEW IF EXISTS members_with_status;
CREATE VIEW members_with_status WITH (security_invoker = true) AS
SELECT m.* FROM members m WHERE m.is_active = true;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Owner password storage (plaintext for admin access per client agreement)
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gyms' AND column_name = 'owner_password'
  ) THEN
    ALTER TABLE gyms ADD COLUMN owner_password text;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Staff table
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  role text NOT NULL DEFAULT 'Trainer',  -- Trainer, Receptionist, Manager, Cleaner, Other
  aadhaar text,
  photo_url text,
  salary_amount numeric DEFAULT 0,
  join_date date DEFAULT CURRENT_DATE,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select" ON staff;
CREATE POLICY "staff_select" ON staff FOR SELECT
  USING (gym_id = get_my_gym_id() OR is_flym_admin());

DROP POLICY IF EXISTS "staff_insert" ON staff;
CREATE POLICY "staff_insert" ON staff FOR INSERT
  WITH CHECK (gym_id = get_my_gym_id() OR is_flym_admin());

DROP POLICY IF EXISTS "staff_update" ON staff;
CREATE POLICY "staff_update" ON staff FOR UPDATE
  USING (gym_id = get_my_gym_id() OR is_flym_admin());

DROP POLICY IF EXISTS "staff_delete" ON staff;
CREATE POLICY "staff_delete" ON staff FOR DELETE
  USING (gym_id = get_my_gym_id() OR is_flym_admin());

-- ═══════════════════════════════════════════════════════════════════
-- 4. Staff attendance table
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'Present',  -- Present, Absent, Half-day, Leave
  check_in time,
  check_out time,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(staff_id, date)
);

ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_att_select" ON staff_attendance;
CREATE POLICY "staff_att_select" ON staff_attendance FOR SELECT
  USING (gym_id = get_my_gym_id() OR is_flym_admin());

DROP POLICY IF EXISTS "staff_att_insert" ON staff_attendance;
CREATE POLICY "staff_att_insert" ON staff_attendance FOR INSERT
  WITH CHECK (gym_id = get_my_gym_id() OR is_flym_admin());

DROP POLICY IF EXISTS "staff_att_update" ON staff_attendance;
CREATE POLICY "staff_att_update" ON staff_attendance FOR UPDATE
  USING (gym_id = get_my_gym_id() OR is_flym_admin());

DROP POLICY IF EXISTS "staff_att_delete" ON staff_attendance;
CREATE POLICY "staff_att_delete" ON staff_attendance FOR DELETE
  USING (gym_id = get_my_gym_id() OR is_flym_admin());

-- ═══════════════════════════════════════════════════════════════════
-- 5. Staff salary payments table
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staff_salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount >= 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_mode text DEFAULT 'Cash' CHECK (payment_mode IN ('Cash', 'Online', 'Card')),
  is_advance boolean DEFAULT false,
  notes text,
  expense_id uuid,  -- links to auto-created expense row
  created_at timestamptz DEFAULT now()
);

ALTER TABLE staff_salary_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_pay_select" ON staff_salary_payments;
CREATE POLICY "staff_pay_select" ON staff_salary_payments FOR SELECT
  USING (gym_id = get_my_gym_id() OR is_flym_admin());

DROP POLICY IF EXISTS "staff_pay_insert" ON staff_salary_payments;
CREATE POLICY "staff_pay_insert" ON staff_salary_payments FOR INSERT
  WITH CHECK (gym_id = get_my_gym_id() OR is_flym_admin());

DROP POLICY IF EXISTS "staff_pay_update" ON staff_salary_payments;
CREATE POLICY "staff_pay_update" ON staff_salary_payments FOR UPDATE
  USING (gym_id = get_my_gym_id() OR is_flym_admin());

DROP POLICY IF EXISTS "staff_pay_delete" ON staff_salary_payments;
CREATE POLICY "staff_pay_delete" ON staff_salary_payments FOR DELETE
  USING (gym_id = get_my_gym_id() OR is_flym_admin());

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_staff_gym ON staff(gym_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_staff_att_date ON staff_attendance(gym_id, date);
CREATE INDEX IF NOT EXISTS idx_staff_pay_date ON staff_salary_payments(gym_id, payment_date);
