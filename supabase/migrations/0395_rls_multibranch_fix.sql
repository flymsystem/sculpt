-- ============================================================
-- RLS FIX: Multi-Branch Gym Owner Support
-- ============================================================
-- PROBLEM: get_my_gym_id() returns only ONE gym UUID (the 
-- currently selected one). Multi-branch owners get blocked 
-- when operating on a non-selected branch.
--
-- FIX: Create a helper function is_my_gym(uuid) that checks 
-- if the gym belongs to the current user, then update all 
-- policies to use it instead of gym_id = get_my_gym_id().
--
-- NOTE: get_my_gym_id() is NOT removed — the dashboard still 
-- uses it to filter which branch to display. We're only 
-- fixing the AUTHORIZATION check, not the UI filter.
-- ============================================================

BEGIN;

-- ── STEP 1: Create helper function ──────────────────────────
CREATE OR REPLACE FUNCTION public.is_my_gym(check_gym_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_users
    WHERE user_id = auth.uid()
      AND role = 'owner'
      AND gym_id = check_gym_id
  );
$function$;


-- ── STEP 2: Fix gyms table ──────────────────────────────────
-- Old: (id = get_my_gym_id())
DROP POLICY IF EXISTS owner_update_own_gym ON gyms;
CREATE POLICY owner_update_own_gym ON gyms
  FOR UPDATE TO public
  USING (is_my_gym(id))
  WITH CHECK (is_my_gym(id));


-- ── STEP 3: Fix members table ───────────────────────────────
-- Old: (gym_id = get_my_gym_id())
DROP POLICY IF EXISTS owner_all_own_members ON members;
CREATE POLICY owner_all_own_members ON members
  FOR ALL TO public
  USING (is_my_gym(gym_id))
  WITH CHECK (is_my_gym(gym_id));


-- ── STEP 4: Fix plans table ────────────────────────────────
DROP POLICY IF EXISTS owner_all_own_plans ON plans;
CREATE POLICY owner_all_own_plans ON plans
  FOR ALL TO public
  USING (is_my_gym(gym_id))
  WITH CHECK (is_my_gym(gym_id));


-- ── STEP 5: Fix payment_history table ───────────────────────
DROP POLICY IF EXISTS owner_all_own_payments ON payment_history;
CREATE POLICY owner_all_own_payments ON payment_history
  FOR ALL TO public
  USING (is_my_gym(gym_id))
  WITH CHECK (is_my_gym(gym_id));


-- ── STEP 6: Fix reminder_logs table ────────────────────────
DROP POLICY IF EXISTS owner_all_own_reminders ON reminder_logs;
CREATE POLICY owner_all_own_reminders ON reminder_logs
  FOR ALL TO public
  USING (is_my_gym(gym_id))
  WITH CHECK (is_my_gym(gym_id));


-- ── STEP 7: Fix activity_log table ─────────────────────────
DROP POLICY IF EXISTS owner_all_own_activity ON activity_log;
CREATE POLICY owner_all_own_activity ON activity_log
  FOR ALL TO public
  USING (is_my_gym(gym_id))
  WITH CHECK (is_my_gym(gym_id));


-- ── STEP 8: Fix addon_templates table ──────────────────────
DROP POLICY IF EXISTS owner_all_own_addon_tpl ON addon_templates;
CREATE POLICY owner_all_own_addon_tpl ON addon_templates
  FOR ALL TO public
  USING (is_my_gym(gym_id))
  WITH CHECK (is_my_gym(gym_id));


-- ── STEP 9: Fix expenses table ─────────────────────────────
DROP POLICY IF EXISTS owner_all_own_expenses ON expenses;
CREATE POLICY owner_all_own_expenses ON expenses
  FOR ALL TO public
  USING (is_my_gym(gym_id))
  WITH CHECK (is_my_gym(gym_id));


-- ── STEP 10: Fix enquiries table ────────────────────────────
DROP POLICY IF EXISTS "Owners see own gym enquiries" ON enquiries;
CREATE POLICY "Owners see own gym enquiries" ON enquiries
  FOR ALL TO public
  USING (is_my_gym(gym_id))
  WITH CHECK (is_my_gym(gym_id));




-- ── STEP 13: Fix staff table ────────────────────────────────
-- Old: ((gym_id = get_my_gym_id()) OR is_flym_admin())
DROP POLICY IF EXISTS staff_select ON staff;
CREATE POLICY staff_select ON staff
  FOR SELECT TO public
  USING ((is_my_gym(gym_id)) OR is_flym_admin());

DROP POLICY IF EXISTS staff_insert ON staff;
CREATE POLICY staff_insert ON staff
  FOR INSERT TO public
  WITH CHECK ((is_my_gym(gym_id)) OR is_flym_admin());

DROP POLICY IF EXISTS staff_update ON staff;
CREATE POLICY staff_update ON staff
  FOR UPDATE TO public
  USING ((is_my_gym(gym_id)) OR is_flym_admin())
  WITH CHECK ((is_my_gym(gym_id)) OR is_flym_admin());

DROP POLICY IF EXISTS staff_delete ON staff;
CREATE POLICY staff_delete ON staff
  FOR DELETE TO public
  USING ((is_my_gym(gym_id)) OR is_flym_admin());


-- ── STEP 14: Fix staff_attendance table ─────────────────────
DROP POLICY IF EXISTS staff_att_select ON staff_attendance;
CREATE POLICY staff_att_select ON staff_attendance
  FOR SELECT TO public
  USING ((is_my_gym(gym_id)) OR is_flym_admin());

DROP POLICY IF EXISTS staff_att_insert ON staff_attendance;
CREATE POLICY staff_att_insert ON staff_attendance
  FOR INSERT TO public
  WITH CHECK ((is_my_gym(gym_id)) OR is_flym_admin());

DROP POLICY IF EXISTS staff_att_update ON staff_attendance;
CREATE POLICY staff_att_update ON staff_attendance
  FOR UPDATE TO public
  USING ((is_my_gym(gym_id)) OR is_flym_admin())
  WITH CHECK ((is_my_gym(gym_id)) OR is_flym_admin());

DROP POLICY IF EXISTS staff_att_delete ON staff_attendance;
CREATE POLICY staff_att_delete ON staff_attendance
  FOR DELETE TO public
  USING ((is_my_gym(gym_id)) OR is_flym_admin());


-- ── STEP 15: Fix staff_salary_payments table ────────────────
DROP POLICY IF EXISTS staff_pay_select ON staff_salary_payments;
CREATE POLICY staff_pay_select ON staff_salary_payments
  FOR SELECT TO public
  USING ((is_my_gym(gym_id)) OR is_flym_admin());

DROP POLICY IF EXISTS staff_pay_insert ON staff_salary_payments;
CREATE POLICY staff_pay_insert ON staff_salary_payments
  FOR INSERT TO public
  WITH CHECK ((is_my_gym(gym_id)) OR is_flym_admin());

DROP POLICY IF EXISTS staff_pay_update ON staff_salary_payments;
CREATE POLICY staff_pay_update ON staff_salary_payments
  FOR UPDATE TO public
  USING ((is_my_gym(gym_id)) OR is_flym_admin())
  WITH CHECK ((is_my_gym(gym_id)) OR is_flym_admin());

DROP POLICY IF EXISTS staff_pay_delete ON staff_salary_payments;
CREATE POLICY staff_pay_delete ON staff_salary_payments
  FOR DELETE TO public
  USING ((is_my_gym(gym_id)) OR is_flym_admin());


-- ── STEP 17: Fix storage objects (gym-logos bucket) ─────────
-- These use storage.foldername(name) to match gym_id
-- The folder structure is: gym-logos/{gym_id}/filename
DROP POLICY IF EXISTS gym_logos_owner_write ON storage.objects;
CREATE POLICY gym_logos_owner_write ON storage.objects
  FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'gym-logos'
    AND is_my_gym((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS gym_logos_owner_update ON storage.objects;
CREATE POLICY gym_logos_owner_update ON storage.objects
  FOR UPDATE TO public
  USING (
    bucket_id = 'gym-logos'
    AND is_my_gym((storage.foldername(name))[1]::uuid)
  )
  WITH CHECK (
    bucket_id = 'gym-logos'
    AND is_my_gym((storage.foldername(name))[1]::uuid)
  );


-- ── STEP 18: Fix storage objects (member-photos bucket) ─────
DROP POLICY IF EXISTS "Gym owners can upload member photos" ON storage.objects;
CREATE POLICY "Gym owners can upload member photos" ON storage.objects
  FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'member-photos'
    AND is_my_gym((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "Gym owners can update member photos" ON storage.objects;
CREATE POLICY "Gym owners can update member photos" ON storage.objects
  FOR UPDATE TO public
  USING (
    bucket_id = 'member-photos'
    AND is_my_gym((storage.foldername(name))[1]::uuid)
  )
  WITH CHECK (
    bucket_id = 'member-photos'
    AND is_my_gym((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "Gym owners can delete member photos" ON storage.objects;
CREATE POLICY "Gym owners can delete member photos" ON storage.objects
  FOR DELETE TO public
  USING (
    bucket_id = 'member-photos'
    AND is_my_gym((storage.foldername(name))[1]::uuid)
  );


COMMIT;

-- ============================================================
-- VERIFICATION: Run this after to confirm everything updated
-- ============================================================
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE qual::text LIKE '%get_my_gym_id%'
--    OR with_check::text LIKE '%get_my_gym_id%';
--
-- Expected: 0 rows (all migrated to is_my_gym)
-- ============================================================
